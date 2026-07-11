import type {
  AnalyticsSummary,
  AppState,
  ISODate,
  MaterialForecast,
  SubjectStat,
} from '../types';
import { addDays, diffDays, formatMinutes } from './date';
import { computeCapacity } from './scheduler';
import { isPlacedPlanTask } from './taskFilters';

// ============================================================
// 分析サマリー(全て実データから計算)
// ============================================================

export function computeAnalytics(state: AppState, ref: ISODate): AnalyticsSummary {
  const sessions = state.sessions.filter((s) => s.date <= ref);

  // --- 日別合計分数 ---
  const minutesByDate = new Map<ISODate, number>();
  for (const s of sessions) {
    minutesByDate.set(s.date, (minutesByDate.get(s.date) ?? 0) + s.minutes);
  }

  // --- 連続学習日数 ---
  let streak = 0;
  {
    let d = ref;
    // 今日まだ勉強していなくても昨日まで続いていればストリーク維持
    if (!minutesByDate.has(d)) d = addDays(d, -1);
    while (minutesByDate.has(d) && (minutesByDate.get(d) ?? 0) > 0) {
      streak += 1;
      d = addDays(d, -1);
    }
  }

  // --- 最長ストリーク ---
  let bestStreak = 0;
  {
    const dates = [...minutesByDate.keys()].sort();
    let cur = 0;
    let prev: ISODate | null = null;
    for (const d of dates) {
      if ((minutesByDate.get(d) ?? 0) <= 0) continue;
      cur = prev !== null && diffDays(prev, d) === 1 ? cur + 1 : 1;
      bestStreak = Math.max(bestStreak, cur);
      prev = d;
    }
  }

  const todayMinutes = minutesByDate.get(ref) ?? 0;
  const weekFrom = addDays(ref, -6);
  const monthFrom = addDays(ref, -29);
  let weekMinutes = 0;
  let monthMinutes = 0;
  for (const [d, m] of minutesByDate) {
    if (d >= weekFrom && d <= ref) weekMinutes += m;
    if (d >= monthFrom && d <= ref) monthMinutes += m;
  }

  // --- 直近7日の予定達成率 ---
  const tasks7d = state.tasks.filter((t) => t.scheduledDate >= weekFrom && t.scheduledDate <= ref);
  const relevant = tasks7d.filter(isPlacedPlanTask);
  const planned7d = relevant.reduce((sum, t) => sum + t.estimatedMinutes, 0);
  const done7d = relevant.filter((t) => t.status === 'done').reduce((sum, t) => sum + t.estimatedMinutes, 0);
  const planAchievementRate7d = planned7d > 0 ? Math.min(1, done7d / planned7d) : 0;

  // --- 科目別統計 (直近14日) ---
  const from14 = addDays(ref, -13);
  const subjectStats: SubjectStat[] = state.subjects.map((subj) => {
    const sTasks = state.tasks.filter(
      (t) => t.subjectId === subj.id && t.scheduledDate >= from14 && t.scheduledDate <= ref && isPlacedPlanTask(t),
    );
    const sSessions = sessions.filter((s) => s.subjectId === subj.id && s.date >= from14 && s.date <= ref);
    const planned = sTasks.reduce((sum, t) => sum + t.estimatedMinutes, 0);
    const actual = sSessions.reduce((sum, s) => sum + s.minutes, 0);
    const done = sTasks.filter((t) => t.status === 'done').reduce((sum, t) => sum + t.estimatedMinutes, 0);
    return {
      subjectId: subj.id,
      plannedMinutes: planned,
      actualMinutes: actual,
      completionRate: planned > 0 ? Math.min(1, done / planned) : 0,
    };
  });

  // --- 教材別予測 ---
  const materialForecasts: MaterialForecast[] = state.materials
    .filter((m) => !m.archived && !m.paused)
    .map((m) => computeMaterialForecast(state, m.id, ref))
    .filter((f): f is MaterialForecast => f !== null);

  const capacity = computeCapacity(state, ref);

  // --- 復習滞留 ---
  const overdueReviewCount = state.tasks.filter(
    (t) => t.type === 'review' && t.status === 'planned' && t.dueDate !== null && t.dueDate < ref,
  ).length;

  // --- ヒートマップ (直近12週 = 84日) ---
  const heatmap: { date: ISODate; minutes: number }[] = [];
  for (let i = 83; i >= 0; i--) {
    const d = addDays(ref, -i);
    heatmap.push({ date: d, minutes: minutesByDate.get(d) ?? 0 });
  }

  const summary: AnalyticsSummary = {
    streakDays: streak,
    bestStreakDays: bestStreak,
    todayMinutes,
    weekMinutes,
    monthMinutes,
    planAchievementRate7d,
    subjectStats,
    materialForecasts,
    capacity,
    overdueReviewCount,
    heatmap,
    comments: [],
  };
  summary.comments = generateComments(state, summary, ref);
  return summary;
}

// ============================================================
// 教材別の完了見込み
// ============================================================

export function computeMaterialForecast(state: AppState, materialId: string, ref: ISODate): MaterialForecast | null {
  const m = state.materials.find((x) => x.id === materialId);
  if (!m) return null;
  const remainingAmount = Math.max(0, m.totalAmount - m.doneAmount);
  const remainingMinutes = remainingAmount * m.minutesPerUnit;
  const daysToTarget = daysInclusive(ref, m.targetDate);
  const requiredPacePerDay = remainingAmount / daysToTarget;

  // 直近14日の実績ペース
  const from = maxDate(addDays(ref, -13), m.startDate ?? m.createdAt.slice(0, 10));
  const recent = state.sessions.filter((s) => s.materialId === m.id && s.date >= from && s.date <= ref);
  const recentAmount = recent.reduce((sum, s) => sum + s.amountDone, 0);
  const activeDays = daysInclusive(from, ref);
  const currentPacePerDay = recentAmount / activeDays;

  let projectedFinishDate: ISODate | null = null;
  if (remainingAmount === 0) {
    projectedFinishDate = ref;
  } else if (currentPacePerDay > 0.01) {
    projectedFinishDate = addDays(ref, Math.ceil(remainingAmount / currentPacePerDay));
  }

  let status: MaterialForecast['status'];
  let delayDays = 0;
  if (remainingAmount === 0) {
    status = 'ahead';
  } else if (projectedFinishDate === null) {
    // 実績がまだない → 期待進捗との比較で判定
    const total = Math.max(1, diffDays(m.startDate ?? m.createdAt.slice(0, 10), m.targetDate));
    const elapsed = Math.max(0, diffDays(m.startDate ?? m.createdAt.slice(0, 10), ref));
    const expected = Math.min(1, elapsed / total);
    const actual = m.totalAmount > 0 ? m.doneAmount / m.totalAmount : 1;
    const gap = expected - actual;
    status = gap > 0.25 ? 'risk' : gap > 0.1 ? 'behind' : 'onTrack';
    delayDays = Math.round(gap * total);
  } else {
    delayDays = diffDays(m.targetDate, projectedFinishDate);
    status = delayDays <= -7 ? 'ahead' : delayDays <= 2 ? 'onTrack' : delayDays <= 10 ? 'behind' : 'risk';
  }

  return {
    materialId: m.id,
    remainingAmount,
    remainingMinutes: Math.round(remainingMinutes),
    requiredPacePerDay: Math.round(requiredPacePerDay * 10) / 10,
    currentPacePerDay: Math.round(currentPacePerDay * 10) / 10,
    projectedFinishDate,
    status,
    delayDays,
  };
}

/** 今日この教材をやるべき量(目標完了日から逆算) */
export function todayQuotaFor(state: AppState, materialId: string, ref: ISODate): number {
  const m = state.materials.find((x) => x.id === materialId);
  if (!m) return 0;
  if (m.paused || m.archived) return 0;
  const remaining = Math.max(0, m.totalAmount - m.doneAmount);
  const days = daysInclusive(ref, m.targetDate);
  const required = Math.ceil(remaining / days);
  const custom = Math.ceil(Math.max(m.dailyTarget ?? 0, (m.weeklyTarget ?? 0) / 7));
  return Math.max(required, custom);
}

function daysInclusive(from: ISODate, to: ISODate): number {
  return Math.max(1, diffDays(from, to) + 1);
}

function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

// ============================================================
// 分析コメント自動生成(実データからの条件分岐)
// ============================================================

function generateComments(state: AppState, a: AnalyticsSummary, ref: ISODate): string[] {
  const comments: string[] = [];
  const name = (id: string) => state.subjects.find((s) => s.id === id)?.name ?? '不明';
  const matName = (id: string) => state.materials.find((m) => m.id === id)?.name ?? '不明';

  // 1. キャパシティ
  if (!a.capacity.ok) {
    comments.push(
      `現在の計画では試験日までに約${formatMinutes(a.capacity.deficitMinutes)}不足しています。教材を絞るか、1日の勉強時間を増やす必要があります。`,
    );
  }

  // 2. 達成率が低い科目と遅れ教材の組み合わせ
  const stats = a.subjectStats.filter((s) => s.plannedMinutes > 0);
  if (stats.length >= 2) {
    const sorted = [...stats].sort((x, y) => x.completionRate - y.completionRate);
    const worst = sorted[0];
    const best = sorted[sorted.length - 1];
    if (worst.completionRate < 0.6 && best.completionRate - worst.completionRate > 0.25) {
      const worstMat = a.materialForecasts.find((f) => {
        const m = state.materials.find((x) => x.id === f.materialId);
        return m?.subjectId === worst.subjectId && (f.status === 'behind' || f.status === 'risk');
      });
      const extra = worstMat ? Math.min(60, Math.max(15, Math.round(worstMat.remainingMinutes / Math.max(1, state.goal ? diffDays(ref, state.goal.examDate) : 30) / 15) * 15)) : 30;
      comments.push(
        `${name(worst.subjectId)}の予定達成率が${Math.round(worst.completionRate * 100)}%と低く、${name(best.subjectId)}より進捗が遅れています。明日以降${name(worst.subjectId)}を1日${extra}分増やすと挽回できる見込みです。`,
      );
    }
  }

  // 3. 危険な教材
  const risky = a.materialForecasts.filter((f) => f.status === 'risk' && f.remainingAmount > 0);
  for (const f of risky.slice(0, 2)) {
    if (f.projectedFinishDate) {
      comments.push(
        `「${matName(f.materialId)}」は現在のペースだと目標より約${f.delayDays}日遅れる見込みです。1日${Math.ceil(f.requiredPacePerDay)}${unitOf(state, f.materialId)}のペースが必要です。`,
      );
    } else {
      comments.push(
        `「${matName(f.materialId)}」は最近学習の記録がありません。今日から1日${Math.ceil(f.requiredPacePerDay)}${unitOf(state, f.materialId)}進めれば目標に間に合います。`,
      );
    }
  }

  // 4. 復習滞留
  if (a.overdueReviewCount >= 3) {
    comments.push(`期限を過ぎた復習が${a.overdueReviewCount}件たまっています。記憶が薄れる前に、今日は復習を優先しましょう。`);
  }

  // 5. ポジティブ要素
  if (a.streakDays >= 3) {
    comments.push(`${a.streakDays}日連続で学習中です。${a.streakDays >= 7 ? '素晴らしい継続力です。' : 'この調子で続けましょう。'}`);
  }
  if (a.planAchievementRate7d >= 0.85 && a.weekMinutes > 0) {
    comments.push(`直近7日の予定達成率は${Math.round(a.planAchievementRate7d * 100)}%。計画通りに進んでいます。`);
  }

  if (comments.length === 0) {
    comments.push('まだ十分なデータがありません。タイマーで勉強を記録すると、ここに分析が表示されます。');
  }
  return comments;
}

function unitOf(state: AppState, materialId: string): string {
  return state.materials.find((m) => m.id === materialId)?.unit ?? '';
}
