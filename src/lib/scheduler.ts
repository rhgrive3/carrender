import type {
  AppState,
  CapacityWarning,
  FixedEvent,
  ISODate,
  Material,
  RescheduleChange,
  RescheduleResult,
  StudyTask,
  Subject,
  TimeRange,
} from '../types';
import { addDays, diffDays, genId, hmToMinutes, minutesToHM, today, weekdayOf, formatMinutes } from './date';

// ============================================================
// 優先度スコア
// ============================================================

export interface ScoreContext {
  state: AppState;
  date: ISODate;
  /** 科目ごとの直近の予定達成率 0-1 (低いほどブースト) */
  subjectAchievement: Map<string, number>;
  /** 教材ごとの直近の平均正答率 0-100 */
  materialAccuracy: Map<string, number | null>;
}

const WEIGHTS = {
  examUrgency: 22,
  targetUrgency: 30,
  importance: 8,
  weakness: 7,
  materialPriority: 8,
  behind: 26,
  reviewUrgency: 40,
  lowAccuracy: 12,
  lowAchievement: 10,
} as const;

/** 教材の新規学習チャンクの優先度スコア */
export function scoreMaterialChunk(
  material: Material,
  remainingAmount: number,
  ctx: ScoreContext,
): number {
  const { state, date } = ctx;
  const subject = state.subjects.find((s) => s.id === material.subjectId);
  if (!subject) return 0;

  const daysToExam = state.goal ? Math.max(1, diffDays(date, state.goal.examDate)) : 90;
  const daysToTarget = Math.max(1, diffDays(date, material.targetDate));
  const overdueDays = Math.max(0, diffDays(material.targetDate, date));
  const deadlineMultiplier =
    material.deadlinePolicy === 'strict' ? 1.25 : material.deadlinePolicy === 'flexible' ? 0.75 : 1;

  // 試験が近いほど全体的に切迫
  const examUrgency = Math.min(1, 30 / daysToExam);

  // 目標完了日への切迫度: 残り量を残り日数でこなせるか
  const requiredPerDay = remainingAmount / daysToTarget;
  const comfortablePerDay = remainingAmount / Math.max(daysToTarget, 30);
  const targetUrgency = Math.min(1.35, requiredPerDay / Math.max(comfortablePerDay * 3, 0.01) + overdueDays / 14);

  // 遅れ具合: 経過時間に対して進捗が足りない度合い
  const totalSpan = Math.max(1, diffDays(toCreatedDate(material), material.targetDate));
  const elapsed = Math.max(0, diffDays(toCreatedDate(material), date));
  const expectedProgress = Math.min(1, elapsed / totalSpan);
  const actualProgress = material.totalAmount > 0 ? material.doneAmount / material.totalAmount : 1;
  const behind = Math.max(0, expectedProgress - actualProgress); // 0-1

  const accuracy = ctx.materialAccuracy.get(material.id) ?? null;
  const lowAccuracyBoost = accuracy !== null && accuracy < 70 ? (70 - accuracy) / 70 : 0;

  const achievement = ctx.subjectAchievement.get(material.subjectId) ?? 1;
  const lowAchievementBoost = Math.max(0, 0.8 - achievement);
  const customPaceBoost =
    material.dailyTarget && material.dailyTarget > requiredPerDay
      ? Math.min(0.35, (material.dailyTarget - requiredPerDay) / Math.max(material.dailyTarget, 1))
      : material.weeklyTarget && material.weeklyTarget / 7 > requiredPerDay
        ? Math.min(0.25, (material.weeklyTarget / 7 - requiredPerDay) / Math.max(material.weeklyTarget / 7, 1))
        : 0;

  return deadlineMultiplier * (
    WEIGHTS.examUrgency * examUrgency +
    WEIGHTS.targetUrgency * targetUrgency +
    WEIGHTS.importance * (subject.importance / 5) +
    WEIGHTS.weakness * (subject.weakness / 5) +
    WEIGHTS.materialPriority * (material.priority / 5) +
    WEIGHTS.materialPriority * (material.examRelevance / 5) +
    WEIGHTS.behind * behind +
    WEIGHTS.lowAccuracy * lowAccuracyBoost +
    WEIGHTS.lowAchievement * lowAchievementBoost +
    WEIGHTS.targetUrgency * customPaceBoost
  );
}

/** 既存タスク(復習・間違い直し・手動)の優先度スコア */
export function scoreExistingTask(task: StudyTask, ctx: ScoreContext): number {
  const { state, date } = ctx;
  const subject = state.subjects.find((s) => s.id === task.subjectId);
  const material = state.materials.find((m) => m.id === task.materialId);

  let score = 0;
  if (subject) {
    score += WEIGHTS.importance * (subject.importance / 5) + WEIGHTS.weakness * (subject.weakness / 5);
  }
  if (material) {
    score += WEIGHTS.materialPriority * (material.priority / 5);
  }
  if (task.dueDate) {
    const overdue = diffDays(task.dueDate, date); // 正=期限超過
    // 期限当日で最大、超過でさらに増加
    const urgency = overdue >= 0 ? 1 + Math.min(1, overdue / 7) : Math.max(0, 1 + overdue / 5);
    score += WEIGHTS.reviewUrgency * urgency;
  }
  if (task.type === 'correction') score += 15;
  const accuracy = task.materialId ? (ctx.materialAccuracy.get(task.materialId) ?? null) : null;
  if (accuracy !== null && accuracy < 70) score += WEIGHTS.lowAccuracy * ((70 - accuracy) / 70);
  return score;
}

function toCreatedDate(material: Material): ISODate {
  return material.startDate ?? material.createdAt.slice(0, 10);
}

// ============================================================
// 利用可能時間・固定予定
// ============================================================

const DAY_START = '07:00';
const DAY_END = '23:00';

interface FreeSlot {
  start: number; // 分
  end: number;
}

export function fixedEventsOn(state: AppState, date: ISODate): FixedEvent[] {
  const wd = weekdayOf(date);
  return state.fixedEvents.filter((e) => (e.date ? e.date === date : e.weekday === wd));
}

export function dayPlanOn(state: AppState, date: ISODate) {
  return state.dayPlans.find((p) => p.date === date) ?? null;
}

export function availabilityWindowsOn(state: AppState, date: ISODate): TimeRange[] {
  const override = dayPlanOn(state, date);
  if (override?.load === 'rest') return [];
  if (override?.availabilityWindows) return override.availabilityWindows;
  const wd = weekdayOf(date);
  const slot = state.availability.find((a) => a.weekday === wd);
  if (slot?.windows && slot.windows.length > 0) return slot.windows;
  if (slot && slot.minutes > 0) {
    const start = wd === 0 || wd === 6 ? hmToMinutes('09:00') : hmToMinutes('18:00');
    return [{ start: minutesToHM(start), end: minutesToHM(start + slot.minutes) }];
  }
  return [];
}

/** 固定予定を除いた自由時間帯(分単位の区間リスト) */
export function freeSlotsOn(state: AppState, date: ISODate): FreeSlot[] {
  const events = fixedEventsOn(state, date)
    .map((e) => ({ start: hmToMinutes(e.start), end: hmToMinutes(e.end) }))
    .sort((a, b) => a.start - b.start);
  const slots: FreeSlot[] = [];
  const baseWindows = availabilityWindowsOn(state, date)
    .map((w) => ({
      start: Math.max(hmToMinutes(DAY_START), hmToMinutes(w.start)),
      end: Math.min(hmToMinutes(DAY_END), hmToMinutes(w.end)),
    }))
    .filter((w) => w.end - w.start >= 15)
    .sort((a, b) => a.start - b.start);
  for (const base of baseWindows) {
    let cursor = base.start;
    for (const ev of events) {
      if (ev.end <= base.start || ev.start >= base.end) continue;
      if (ev.start > cursor) slots.push({ start: cursor, end: Math.min(ev.start, base.end) });
      cursor = Math.max(cursor, ev.end);
    }
    if (cursor < base.end) slots.push({ start: cursor, end: base.end });
  }
  return slots.filter((s) => s.end - s.start >= 15);
}

/** その日の勉強可能分数(曜日設定と上限でクリップ) */
export function availableMinutesOn(state: AppState, date: ISODate): number {
  const override = dayPlanOn(state, date);
  if (override?.load === 'rest') return 0;
  const wd = weekdayOf(date);
  const slot = state.availability.find((a) => a.weekday === wd);
  const windows = freeSlotsOn(state, date);
  const windowMinutes = windows.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
  const declared = slot ? slot.minutes : windowMinutes;
  const base = Math.min(declared, windowMinutes, state.settings.maxDailyMinutes);
  const factor = override?.load === 'light' ? 0.6 : override?.load === 'heavy' ? 1.2 : 1;
  return Math.max(0, Math.round(Math.min(windowMinutes, base * factor)));
}

// ============================================================
// プラン生成 (核となるアルゴリズム)
// ============================================================

const HORIZON_DAYS = 120;
const MAX_SAME_SUBJECT_STREAK = 2; // 同一科目の連続ブロック数上限

/**
 * fromDate以降の自動生成タスクを全消しして全体を再計算する。
 * 未達成(期限切れplanned/postponed)タスクも翌日に積むのではなく、
 * スコア順で全体に再配置する。
 */
export function generatePlan(
  state: AppState,
  fromDate: ISODate,
  reason: string,
): { state: AppState; result: RescheduleResult } {
  const goal = state.goal;
  const horizonEnd = goal
    ? addDays(fromDate, Math.min(HORIZON_DAYS - 1, Math.max(0, diffDays(fromDate, goal.examDate))))
    : addDays(fromDate, HORIZON_DAYS - 1);

  // --- 変更前のスナップショット(差分表示用) ---
  const beforeMinutes = plannedMinutesBySubject(state.tasks, fromDate, horizonEnd);
  const beforeTaskDates = new Map(state.tasks.map((t) => [t.id, t.scheduledDate]));

  // --- 1. 保持するタスクと再配置対象を分ける ---
  // fromDateが明日以降の場合、今日〜fromDate前日の未着手タスクは
  // 「進行中の当日計画」としてそのまま維持する(記録するたびに今日が崩れないように)
  const todayDate = today();
  const keepStart = todayDate < fromDate ? todayDate : fromDate;
  const kept: StudyTask[] = [];
  const toPlace: StudyTask[] = []; // 復習・間違い直し・手動・未達成 → 再配置
  for (const t of state.tasks) {
    if (t.status === 'done' || t.status === 'skipped' || t.status === 'doing') {
      kept.push(t);
      continue;
    }
    if (t.scheduledDate >= keepStart && t.scheduledDate < fromDate) {
      kept.push(t);
      continue;
    }
    if (t.generatedBy === 'auto' && t.type === 'new') {
      // 自動生成の新規学習タスクは作り直す(教材残量から再生成)
      continue;
    }
    toPlace.push({ ...t, status: 'planned' });
  }

  // --- 2. スコア文脈を構築 ---
  const ctx: ScoreContext = {
    state,
    date: fromDate,
    subjectAchievement: subjectAchievementMap(state, fromDate),
    materialAccuracy: materialAccuracyMap(state),
  };

  // --- 3. 教材ごとの残量シミュレーション ---
  const remaining = new Map<string, number>();
  for (const m of state.materials) {
    if (m.archived || m.paused) continue;
    remaining.set(m.id, Math.max(0, m.totalAmount - m.doneAmount));
  }
  // 維持・再配置される既存の「新規」タスクが担当する量は差し引く(同じ範囲の二重配置を防ぐ)
  for (const t of [...kept, ...toPlace]) {
    if (t.type === 'new' && t.materialId && (t.status === 'planned' || t.status === 'doing')) {
      remaining.set(t.materialId, Math.max(0, (remaining.get(t.materialId) ?? 0) - t.amount));
    }
  }

  const newTasks: StudyTask[] = [];
  const postponedChanges: RescheduleChange[] = [];

  // --- 4. 日ごとに埋める ---
  let day = fromDate;
  while (day <= horizonEnd) {
    const capacity = availableMinutesOn(state, day);
    // その日にすでに確定している分(doing/done)を差し引く
    const usedByKept = kept
      .filter((t) => t.scheduledDate === day && t.status !== 'skipped')
      .reduce((s, t) => s + t.estimatedMinutes, 0);
    let budget = Math.max(0, capacity - usedByKept);

    const slots = freeSlotsOn(state, day);
    let slotIdx = 0;
    let slotCursor = slots.length > 0 ? slots[0].start : hmToMinutes(DAY_START);
    let lastSubject: string | null = null;
    let sameSubjectStreak = 0;
    // 1科目が1日を占有しないための上限(1日の55%か90分の大きい方)
    const subjectDayCap = Math.max(90, Math.round(capacity * 0.55));
    const minutesBySubject = new Map<string, number>();

    const advanceSlot = (need: number): { start: number; end: number } | null => {
      while (slotIdx < slots.length) {
        const slot = slots[slotIdx];
        const start = Math.max(slotCursor, slot.start);
        if (slot.end - start >= need) {
          slotCursor = start + need;
          return { start, end: start + need };
        }
        slotIdx += 1;
        if (slotIdx < slots.length) slotCursor = slots[slotIdx].start;
      }
      return null;
    };

    // 空き枠の大きさ(現在のスロット残り)を見て、軽い/重いタスクを選ぶ
    const currentSlotRemaining = (): number => {
      if (slotIdx >= slots.length) return 0;
      return slots[slotIdx].end - Math.max(slotCursor, slots[slotIdx].start);
    };

    while (budget >= state.settings.sessionMinMinutes) {
      const gap = Math.min(currentSlotRemaining(), budget);
      if (gap < state.settings.sessionMinMinutes) {
        slotIdx += 1;
        if (slotIdx >= slots.length) break;
        slotCursor = slots[slotIdx].start;
        continue;
      }

      // 候補を集める: (a) 再配置待ちタスク (b) 教材チャンク
      type Candidate =
        | { kind: 'existing'; task: StudyTask; score: number; minutes: number }
        | { kind: 'chunk'; material: Material; score: number; minutes: number; amount: number };

      const candidates: Candidate[] = [];

      for (const t of toPlace) {
        const material = t.materialId ? state.materials.find((m) => m.id === t.materialId) : null;
        if (material?.paused || material?.archived) continue;
        const due = t.dueDate ?? day;
        if (due > day && t.type !== 'new') {
          // 期限がまだ先の復習は期限日以降に配置
          if (due > day) continue;
        }
        const score = scoreExistingTask(t, { ...ctx, date: day });
        candidates.push({ kind: 'existing', task: t, score, minutes: Math.min(t.estimatedMinutes, gap) });
      }

      for (const m of state.materials) {
        if (m.archived || m.paused) continue;
        const rem = remaining.get(m.id) ?? 0;
        if (rem <= 0) continue;
        const score = scoreMaterialChunk(m, rem, { ...ctx, date: day });
        // チャンクサイズ: 空き枠と90分上限に収まる単位数を計算
        const maxChunk = Math.min(gap, state.settings.sessionMaxMinutes);
        let amount = Math.floor(maxChunk / m.minutesPerUnit);
        if (amount < 1) {
          // 1単位が90分を超える重い教材は、空き枠に収まる場合のみ1単位置く
          if (m.minutesPerUnit <= gap) amount = 1;
          else continue;
        }
        amount = Math.min(amount, rem);
        const minutes = Math.max(state.settings.sessionMinMinutes, Math.round(amount * m.minutesPerUnit));
        if (minutes > gap) continue;
        candidates.push({ kind: 'chunk', material: m, score, minutes, amount });
      }

      if (candidates.length === 0) break;

      // 同一科目の連続・使いすぎを抑制するペナルティを適用しつつ最高スコアを選ぶ
      const subjectOf = (c: (typeof candidates)[number]) => (c.kind === 'existing' ? c.task.subjectId : c.material.subjectId);
      const penaltyOf = (c: (typeof candidates)[number]) => {
        const subj = subjectOf(c);
        let pen = 0;
        if (subj === lastSubject && sameSubjectStreak >= MAX_SAME_SUBJECT_STREAK) pen += 40;
        if ((minutesBySubject.get(subj) ?? 0) + c.minutes > subjectDayCap) pen += 60;
        return pen;
      };
      candidates.sort((a, b) => b.score - penaltyOf(b) - (a.score - penaltyOf(a)));

      const best = candidates[0];
      const bestSubject = best.kind === 'existing' ? best.task.subjectId : best.material.subjectId;
      const window = advanceSlot(best.minutes);
      if (!window) break;

      if (best.kind === 'existing') {
        const t = best.task;
        toPlace.splice(toPlace.indexOf(t), 1);
        const movedFrom = beforeTaskDates.get(t.id);
        newTasks.push({
          ...t,
          scheduledDate: day,
          scheduledStart: minutesToHM(window.start),
          scheduledEnd: minutesToHM(window.end),
          priority: best.score,
          status: 'planned',
        });
        if (movedFrom && movedFrom !== day && movedFrom < fromDate) {
          postponedChanges.push({
            kind: 'moved',
            taskTitle: t.title,
            subjectId: t.subjectId,
            detail: `未達成分を${day.slice(5).replace('-', '/')}に再配置`,
          });
        }
      } else {
        const m = best.material;
        const rem = remaining.get(m.id) ?? 0;
        const startUnit = m.totalAmount - rem + 1;
        const endUnit = Math.min(m.totalAmount, startUnit + best.amount - 1);
        remaining.set(m.id, Math.max(0, rem - best.amount));
        newTasks.push(makeChunkTask(m, day, window, startUnit, endUnit, best.score));
      }

      budget -= best.minutes;
      minutesBySubject.set(bestSubject, (minutesBySubject.get(bestSubject) ?? 0) + best.minutes);
      if (bestSubject === lastSubject) sameSubjectStreak += 1;
      else {
        lastSubject = bestSubject;
        sameSubjectStreak = 1;
      }
    }

    day = addDays(day, 1);
  }

  // 配置しきれなかった再配置待ちタスクは期限順で先送り(期間外)
  for (const t of toPlace) {
    const target = t.dueDate && t.dueDate > horizonEnd ? t.dueDate : addDays(horizonEnd, 1);
    newTasks.push({ ...t, scheduledDate: target, scheduledStart: null, scheduledEnd: null, status: 'planned' });
    postponedChanges.push({
      kind: 'postponed',
      taskTitle: t.title,
      subjectId: t.subjectId,
      detail: `空き時間が足りず${target.slice(5).replace('-', '/')}以降に延期`,
    });
  }

  for (const m of state.materials) {
    if (m.archived || m.paused) continue;
    const rem = remaining.get(m.id) ?? 0;
    if (rem > 0 && m.targetDate <= horizonEnd) {
      const days = Math.max(1, diffDays(fromDate, m.targetDate));
      postponedChanges.push({
        kind: 'grown',
        taskTitle: m.name,
        subjectId: m.subjectId,
        detail: `期限に間に合わせるには1日あたり約${Math.ceil(rem / days)}${m.unit}の追加が必要`,
      });
    }
  }

  const allTasks = [...kept, ...newTasks];
  const capacity = computeCapacity({ ...state, tasks: allTasks }, fromDate);

  // --- 5. 差分サマリー ---
  const afterMinutes = plannedMinutesBySubject(allTasks, fromDate, horizonEnd);
  const subjectMinuteDelta: RescheduleResult['subjectMinuteDelta'] = [];
  const subjectIds = new Set([...beforeMinutes.keys(), ...afterMinutes.keys()]);
  for (const sid of subjectIds) {
    const delta = (afterMinutes.get(sid) ?? 0) - (beforeMinutes.get(sid) ?? 0);
    if (Math.abs(delta) >= 15) subjectMinuteDelta.push({ subjectId: sid, deltaMinutes: delta });
  }
  subjectMinuteDelta.sort((a, b) => Math.abs(b.deltaMinutes) - Math.abs(a.deltaMinutes));

  const result: RescheduleResult = {
    at: new Date().toISOString(),
    reason,
    changes: postponedChanges.slice(0, 8),
    subjectMinuteDelta,
    capacity,
    summaryText: buildSummaryText(state.subjects, subjectMinuteDelta, postponedChanges, capacity, reason),
  };

  return {
    state: { ...state, tasks: allTasks, lastReschedule: result, lastPlannedDate: horizonEnd },
    result,
  };
}

function makeChunkTask(
  m: Material,
  day: ISODate,
  window: { start: number; end: number },
  startUnit: number,
  endUnit: number,
  score: number,
): StudyTask {
  const rangeLabel = startUnit === endUnit ? `${startUnit}${m.unit}` : `${startUnit}〜${endUnit}${m.unit}`;
  return {
    id: genId('task'),
    subjectId: m.subjectId,
    materialId: m.id,
    title: `${m.name}`,
    rangeLabel: `${m.round > 1 ? `${m.round}周目 ` : ''}${rangeLabel}`,
    rangeStart: startUnit,
    rangeEnd: endUnit,
    amount: endUnit - startUnit + 1,
    estimatedMinutes: window.end - window.start,
    priority: score,
    dueDate: m.targetDate,
    memo: '',
    type: 'new',
    status: 'planned',
    scheduledDate: day,
    scheduledStart: minutesToHM(window.start),
    scheduledEnd: minutesToHM(window.end),
    generatedBy: 'auto',
    reviewStage: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
}

// ============================================================
// 集計ヘルパー
// ============================================================

function plannedMinutesBySubject(tasks: StudyTask[], from: ISODate, to: ISODate): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of tasks) {
    if (t.scheduledDate < from || t.scheduledDate > to) continue;
    if (t.status === 'skipped') continue;
    map.set(t.subjectId, (map.get(t.subjectId) ?? 0) + t.estimatedMinutes);
  }
  return map;
}

/** 直近14日間の科目別 予定達成率 */
export function subjectAchievementMap(state: AppState, ref: ISODate): Map<string, number> {
  const from = addDays(ref, -14);
  const planned = new Map<string, number>();
  const done = new Map<string, number>();
  for (const t of state.tasks) {
    if (t.scheduledDate < from || t.scheduledDate >= ref) continue;
    planned.set(t.subjectId, (planned.get(t.subjectId) ?? 0) + 1);
    if (t.status === 'done') done.set(t.subjectId, (done.get(t.subjectId) ?? 0) + 1);
  }
  const map = new Map<string, number>();
  for (const [sid, p] of planned) {
    map.set(sid, p > 0 ? (done.get(sid) ?? 0) / p : 1);
  }
  return map;
}

/** 教材別 直近の平均正答率 */
export function materialAccuracyMap(state: AppState): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const m of state.materials) {
    const recs = state.sessions
      .filter((s) => s.materialId === m.id && s.accuracy !== null)
      .slice(-5);
    if (recs.length === 0) {
      map.set(m.id, null);
    } else {
      map.set(m.id, recs.reduce((sum, r) => sum + (r.accuracy ?? 0), 0) / recs.length);
    }
  }
  return map;
}

// ============================================================
// キャパシティ警告
// ============================================================

export function computeCapacity(state: AppState, ref: ISODate): CapacityWarning {
  const goal = state.goal;
  const examDate = goal ? goal.examDate : addDays(ref, 90);

  // 残り学習量(分): 教材残量 + 未完了の復習/手動タスク
  let remainingMinutes = 0;
  for (const m of state.materials) {
    if (m.archived || m.paused) continue;
    remainingMinutes += Math.max(0, m.totalAmount - m.doneAmount) * m.minutesPerUnit;
  }
  for (const t of state.tasks) {
    if (t.status === 'planned' && t.type !== 'new') remainingMinutes += t.estimatedMinutes;
  }

  // 試験日までの利用可能分数
  let available = 0;
  let d = ref;
  while (d <= examDate) {
    available += availableMinutesOn(state, d);
    d = addDays(d, 1);
  }

  const deficit = remainingMinutes - available;
  return {
    totalRemainingMinutes: Math.round(remainingMinutes),
    totalAvailableMinutes: Math.round(available),
    deficitMinutes: Math.round(deficit),
    ok: deficit <= 0,
  };
}

// ============================================================
// サマリーテキスト生成
// ============================================================

function buildSummaryText(
  subjects: Subject[],
  deltas: { subjectId: string; deltaMinutes: number }[],
  changes: RescheduleChange[],
  capacity: CapacityWarning,
  reason: string,
): string {
  const name = (id: string) => subjects.find((s) => s.id === id)?.name ?? '不明';
  const parts: string[] = [];

  const increased = deltas.filter((d) => d.deltaMinutes > 0).slice(0, 2);
  const decreased = deltas.filter((d) => d.deltaMinutes < 0).slice(0, 2);
  if (increased.length > 0 && decreased.length > 0) {
    parts.push(
      `${decreased.map((d) => `${name(d.subjectId)}を${formatMinutes(-d.deltaMinutes)}減らし`).join('、')}、${increased
        .map((d) => `${name(d.subjectId)}を${formatMinutes(d.deltaMinutes)}増やしました`)
        .join('、')}。`,
    );
  } else if (increased.length > 0) {
    parts.push(`${increased.map((d) => `${name(d.subjectId)}を${formatMinutes(d.deltaMinutes)}増やしました`).join('、')}。`);
  } else if (decreased.length > 0) {
    parts.push(`${decreased.map((d) => `${name(d.subjectId)}を${formatMinutes(-d.deltaMinutes)}減らしました`).join('、')}。`);
  }

  const postponed = changes.filter((c) => c.kind === 'postponed');
  if (postponed.length > 0) parts.push(`${postponed.length}件のタスクを延期しました。`);

  if (!capacity.ok) {
    parts.push(`現在の計画では試験日までに約${formatMinutes(capacity.deficitMinutes)}不足しています。`);
  } else if (parts.length === 0) {
    parts.push('計画を最新の実績に合わせて最適化しました。');
  }

  return `${reason}のため計画を再設計しました。` + parts.join(' ');
}

// ============================================================
// 今日の状態判定
// ============================================================

export type DayStatus = 'ahead' | 'onTrack' | 'slightlyBehind' | 'danger';

export function computeDayStatus(state: AppState, date: ISODate): DayStatus {
  const cap = computeCapacity(state, date);
  if (!cap.ok && cap.deficitMinutes > 600) return 'danger';

  const overdueTasks = state.tasks.filter(
    (t) => t.status === 'planned' && t.scheduledDate < date,
  ).length;
  const behindMaterials = state.materials.filter((m) => {
    if (m.archived || m.totalAmount === 0) return false;
    const total = Math.max(1, diffDays(m.startDate ?? m.createdAt.slice(0, 10), m.targetDate));
    const elapsed = Math.max(0, diffDays(m.startDate ?? m.createdAt.slice(0, 10), date));
    return m.doneAmount / m.totalAmount < Math.min(1, elapsed / total) - 0.1;
  }).length;

  if (!cap.ok || overdueTasks >= 5 || behindMaterials >= 3) return 'danger';
  if (overdueTasks >= 2 || behindMaterials >= 1) return 'slightlyBehind';
  const achievement = subjectAchievementMap(state, date);
  const vals = [...achievement.values()];
  const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 1;
  if (avg >= 0.9 && cap.deficitMinutes < -600) return 'ahead';
  return 'onTrack';
}

export { today };
