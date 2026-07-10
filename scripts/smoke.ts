/**
 * ロジック層のスモークテスト (UIなしで検証)
 * 実行: npx vite-node scripts/smoke.ts
 */
import { buildDemoState } from '../src/data/demo';
import { generatePlan, generatePlanV2, computeCapacity, computeDayStatus, availableMinutesOn, freeSlotsOn, fixedEventsOn, mergeMinuteRanges, normalizeUnitRanges, remainingUnitRanges, updateMinutesPerUnitEstimate } from '../src/lib/scheduler';
import { generateReviewTasks } from '../src/lib/review';
import { computeAnalytics, todayQuotaFor } from '../src/lib/analytics';
import { computeAchievements, unlockedCount } from '../src/lib/achievements';
import { addDays, today } from '../src/lib/date';
import { normalizeState } from '../src/lib/storage';
import { normalizeTaskSchedule } from '../src/lib/taskSchedule';
import { appReducer, emptyState } from '../src/state/AppContext';
import type { AppState, Material, StudySession, StudyTask } from '../src/types';

const t = today();
let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failures++;
    console.log(`  ❌ ${name}`, detail ?? '');
  }
}

console.log('--- デモデータ生成 ---');
const state = buildDemoState();
check('目標がある', state.goal !== null);
check('科目7つ', state.subjects.length === 7);
check('教材8つ', state.materials.length === 8);
check('実績セッションあり', state.sessions.length > 20, state.sessions.length);

const todayTasks = state.tasks.filter((x) => x.scheduledDate === t && x.status === 'planned');
console.log(`今日のタスク: ${todayTasks.length}件`);
for (const task of todayTasks) {
  const s = state.subjects.find((x) => x.id === task.subjectId);
  console.log(`   [${s?.name}] ${task.title} ${task.rangeLabel} ${task.scheduledStart}〜${task.scheduledEnd} (${task.estimatedMinutes}分, type=${task.type})`);
}
check('今日のタスクが生成されている', todayTasks.length >= 2);

const cap = availableMinutesOn(state, t);
const planned = todayTasks.reduce((s, x) => s + x.estimatedMinutes, 0);
check(`今日の予定(${planned}分)が可能時間(${cap}分)以内`, planned <= cap);

// 固定予定と重ならないか
const slots = freeSlotsOn(state, t);
console.log('自由時間帯:', slots.map((s) => `${Math.floor(s.start / 60)}:${String(s.start % 60).padStart(2, '0')}-${Math.floor(s.end / 60)}:${String(s.end % 60).padStart(2, '0')}`).join(', '));
for (const task of todayTasks) {
  if (!task.scheduledStart || !task.scheduledEnd) continue;
  const [sh, sm] = task.scheduledStart.split(':').map(Number);
  const [eh, em] = task.scheduledEnd.split(':').map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  const inSlot = slots.some((s) => start >= s.start && end <= s.end);
  check(`「${task.title}」(${task.scheduledStart}-${task.scheduledEnd})が固定予定と重ならない`, inSlot);
}

// 1コマ25〜90分
const outOfRange = state.tasks.filter(
  (x) => {
    if (x.generatedBy !== 'auto' || x.status !== 'planned' || !x.scheduledStart || (x.estimatedMinutes >= 24 && x.estimatedMinutes <= 90)) return false;
    const isFinalMaterialRemainder = x.materialId !== null && x.rangeEnd !== null && !state.tasks.some((other) =>
      other.id !== x.id && other.materialId === x.materialId && other.status === 'planned' && other.rangeStart !== null && other.rangeStart > x.rangeEnd!,
    );
    return !isFinalMaterialRemainder;
  },
);
check('全自動タスクが25〜90分の範囲(最終残量を除く)', outOfRange.length === 0, outOfRange.map((x) => `${x.title} ${x.estimatedMinutes}分`));

// 未達成タスクがデモに含まれる
const overdueDemo = state.tasks.filter((x) => x.status === 'planned' && x.scheduledDate < t);
check('デモに未達成タスクがある', overdueDemo.length >= 2, overdueDemo.length);

console.log('--- 週間タスク分布 ---');
for (let i = 0; i < 7; i++) {
  const d = addDays(t, i);
  const dayTasks = state.tasks.filter((x) => x.scheduledDate === d && x.status !== 'done');
  const min = dayTasks.reduce((s, x) => s + x.estimatedMinutes, 0);
  const subjects = new Set(dayTasks.map((x) => x.subjectId)).size;
  console.log(`  ${d}: ${dayTasks.length}件 ${min}分 (${subjects}科目) / 上限${availableMinutesOn(state, d)}分`);
}

console.log('--- キャパシティ ---');
const capacity = computeCapacity(state, t);
console.log(`  残り学習量 ${Math.round(capacity.totalRemainingMinutes / 60)}h / 確保可能 ${Math.round(capacity.totalAvailableMinutes / 60)}h / 不足 ${Math.round(capacity.deficitMinutes / 60)}h ok=${capacity.ok}`);
console.log(`  今日の状態: ${computeDayStatus(state, t)}`);

console.log('--- 再スケジューリング ---');
const { state: s2, result } = generatePlan(state, t, 'テスト再計算');
check('再計算が完了', s2.tasks.length > 0);
console.log(`  サマリー: ${result.summaryText}`);

{
  const fixedNow = new Date('2026-07-09T02:34:00.000Z'); // Asia/Tokyo 11:34
  const base = emptyState();
  const rescheduledToday = generatePlan(
    {
      ...base,
      onboarded: true,
      goal: { id: 'goal_test', name: 'テスト', examDate: '2026-07-20', createdAt: fixedNow.toISOString() },
      subjects: [{ id: 'subj_test', name: '数学', color: '#4f7cff', importance: 3, weakness: 3 }],
      materials: [
        {
          id: 'mat_test',
          subjectId: 'subj_test',
          name: '問題集',
          unit: 'ページ',
          totalAmount: 20,
          doneAmount: 0,
          startDate: '2026-07-09',
          targetDate: '2026-07-20',
          priority: 3,
          difficulty: 3,
          minutesPerUnit: 25,
          dailyTarget: null,
          weeklyTarget: null,
          deadlinePolicy: 'normal',
          examRelevance: 3,
          reviewEnabled: true,
          reviewIntervals: [1, 3, 7],
          paused: false,
          round: 1,
          archived: false,
          createdAt: fixedNow.toISOString(),
        },
      ],
      availability: [{ weekday: 4, minutes: 180, windows: [{ start: '09:00', end: '12:00' }] }],
      settings: { ...base.settings, sessionMinMinutes: 25, sessionMaxMinutes: 90, maxDailyMinutes: 180 },
    },
    '2026-07-09',
    '当日再計算テスト',
    { now: fixedNow },
  ).state;
  const firstTask = rescheduledToday.tasks
    .filter((task) => task.scheduledDate === '2026-07-09' && task.status === 'planned')
    .sort((a, b) => (a.scheduledStart ?? '99:99').localeCompare(b.scheduledStart ?? '99:99'))[0];
  check('当日の再計算は現在時刻以降から組む', firstTask?.scheduledStart === '11:35', firstTask);
}

{
  const fixedNow = new Date('2026-07-08T00:00:00.000Z');
  const base = emptyState();
  const subject = { id: 'subj_balance', name: '数学', color: '#4f7cff', importance: 3, weakness: 3 } as const;
  const makeMaterial = (id: string, name: string): Material => ({
    id,
    subjectId: subject.id,
    name,
    unit: '問題',
    totalAmount: 30,
    doneAmount: 0,
    startDate: '2026-07-10',
    targetDate: '2026-07-20',
    priority: 3,
    difficulty: 3,
    minutesPerUnit: 30,
    dailyTarget: null,
    weeklyTarget: null,
    deadlinePolicy: 'normal',
    examRelevance: 3,
    reviewEnabled: true,
    reviewIntervals: [1, 3, 7],
    paused: false,
    round: 1,
    archived: false,
    createdAt: fixedNow.toISOString(),
  });
  const balanceState: AppState = {
    ...base,
    onboarded: true,
    goal: { id: 'goal_balance', name: 'テスト', examDate: '2026-08-01', createdAt: fixedNow.toISOString() },
    subjects: [subject],
    materials: [makeMaterial('mat_a', 'A問題集'), makeMaterial('mat_b', 'B問題集'), makeMaterial('mat_c', 'C問題集')],
    availability: ([0, 1, 2, 3, 4, 5, 6] as const).map((weekday) => ({
      weekday,
      minutes: 270,
      windows: [{ start: '09:00', end: '13:30' }],
    })),
    settings: { ...base.settings, sessionMinMinutes: 30, sessionMaxMinutes: 90, maxDailyMinutes: 270 },
  };
  const balanced = generatePlan(balanceState, '2026-07-10', '配分テスト', { now: fixedNow }).state;
  const firstDay = balanced.tasks.filter((task) => task.scheduledDate === '2026-07-10' && task.status === 'planned');
  const materialCount = new Set(firstDay.map((task) => task.materialId)).size;
  const maxMaterialMinutes = Math.max(
    0,
    ...balanceState.materials.map((material) =>
      firstDay.filter((task) => task.materialId === material.id).reduce((sum, task) => sum + task.estimatedMinutes, 0),
    ),
  );
  check('同条件の教材は初日から複数教材に分散される', materialCount === 3 && maxMaterialMinutes <= 90, {
    materialCount,
    maxMaterialMinutes,
    firstDay: firstDay.map((task) => `${task.title} ${task.estimatedMinutes}分`),
  });
}

console.log('--- 復習タスク生成 ---');
const doneTask = todayTasks.find((task) => task.type === 'new') ?? todayTasks[0];
const reviewSeedTask = { ...doneTask, type: 'review' as const, reviewStage: 0, rangeLabel: `復習1回目 ${doneTask.rangeLabel}` };
const reviewDisabledState = {
  ...state,
  materials: state.materials.map((material) =>
    material.id === reviewSeedTask.materialId ? { ...material, reviewEnabled: false } : material,
  ),
};
const disabledReviews = generateReviewTasks(reviewDisabledState, reviewSeedTask, t);
check('復習オフの教材では復習を生成しない', disabledReviews.length === 0, disabledReviews);
const missingMaterialReviews = generateReviewTasks(state, { ...reviewSeedTask, materialId: 'missing_material' }, t);
check('教材が明示的に復習オンでない場合は復習を生成しない', missingMaterialReviews.length === 0, missingMaterialReviews);
const reviews = generateReviewTasks(state, reviewSeedTask, t);
check('復習オンの教材では次の復習だけが生成される', reviews.length === 1 && reviews[0].type === 'review', reviews.map((r) => r.rangeLabel));
for (const r of reviews) console.log(`   ${r.type}: ${r.rangeLabel} due=${r.dueDate}`);

{
  // 復習オフに変更したら、生成済みの未着手復習タスクが再計算で計画から消える
  const plannedReview: StudyTask = {
    ...reviews[0],
    id: 'task_review_off_test',
    status: 'planned',
    scheduledDate: addDays(t, 1),
  };
  const withReview = { ...state, tasks: [...state.tasks, plannedReview] };
  const { state: offState } = generatePlan(
    {
      ...withReview,
      materials: withReview.materials.map((material) =>
        material.id === plannedReview.materialId ? { ...material, reviewEnabled: false } : material,
      ),
    },
    t,
    '復習オフの反映',
  );
  check(
    '復習オフにすると生成済みの復習タスクが計画から外れる',
    !offState.tasks.some((task) => task.id === plannedReview.id),
  );
  const { state: onState } = generatePlan(withReview, t, '復習オンのまま再計算');
  check(
    '復習オンのままなら生成済みの復習タスクは残る',
    onState.tasks.some((task) => task.id === plannedReview.id),
  );

  // 設定のグローバルスイッチ: オフなら教材設定に関わらず生成せず、生成済みも外す
  const globalOff = {
    ...withReview,
    settings: { ...withReview.settings, reviewRule: { ...withReview.settings.reviewRule, enabled: false } },
  };
  check('全体の復習自動生成オフでは新規生成されない', generateReviewTasks(globalOff, reviewSeedTask, t).length === 0);
  const { state: globalOffState } = generatePlan(globalOff, t, '復習の自動生成をオフ');
  check(
    '全体の復習自動生成オフで生成済みの復習タスクも計画から外れる',
    !globalOffState.tasks.some((task) => task.id === plannedReview.id),
  );
}

{
  const onboarded = appReducer(emptyState(), {
    type: 'COMPLETE_ONBOARDING',
    input: {
      goalName: '復習デフォルトテスト',
      examDate: addDays(t, 60),
      subjects: [{ name: '数学', color: '#4f7cff', importance: 3, weakness: 3 }],
      weekdayMinutes: 60,
      weekendMinutes: 60,
      materials: [
        {
          subjectIndex: 0,
          name: '初期教材',
          unit: '問題',
          totalAmount: 10,
          targetDate: addDays(t, 30),
          minutesPerUnit: 10,
        },
      ],
    },
  });
  check('オンボーディング教材は復習オフで作成される', onboarded.materials.every((material) => material.reviewEnabled === false));
}

{
  const legacyMaterial = { ...state.materials[0] };
  delete (legacyMaterial as Partial<Material>).reviewEnabled;
  const legacyRule = { ...state.settings.reviewRule } as Partial<AppState['settings']['reviewRule']>;
  delete legacyRule.enabled;
  const normalized = normalizeState({
    ...state,
    materials: [legacyMaterial as Material],
    settings: { ...state.settings, reviewRule: legacyRule as AppState['settings']['reviewRule'] },
  });
  check('古い保存データに復習設定が無い場合も復習オフで補完される', normalized.materials[0]?.reviewEnabled === false);
  check('古い保存データの復習ルールは自動生成オンで補完される', normalized.settings.reviewRule.enabled === true);

  // 廃止した「間違い直し」タスクは復習として読み替える
  const legacyCorrection = { ...state.tasks[0], id: 'task_legacy_correction', type: 'correction' as unknown as StudyTask['type'] };
  const migrated = normalizeState({ ...state, tasks: [legacyCorrection] });
  check('旧データの間違い直しタスクは復習タスクへ移行される', migrated.tasks[0]?.type === 'review');
}

console.log('--- 分析 ---');
const a = computeAnalytics(state, t);
console.log(`  連続${a.streakDays}日(最高${a.bestStreakDays}日) 今週${Math.round(a.weekMinutes / 60)}h 達成率7d=${Math.round(a.planAchievementRate7d * 100)}%`);
check('ストリーク計算', a.streakDays >= 1);
check('教材予測が全教材分', a.materialForecasts.length === 8);
const mathForecast = a.materialForecasts.find((f) => f.materialId === 'mat_chart');
console.log(`  青チャート: status=${mathForecast?.status} 見込み=${mathForecast?.projectedFinishDate} 必要ペース=${mathForecast?.requiredPacePerDay}/日 実績ペース=${mathForecast?.currentPacePerDay}/日`);
check('数学(遅れ設定)がbehind/riskと判定される', mathForecast?.status === 'behind' || mathForecast?.status === 'risk', mathForecast?.status);
console.log('  コメント:');
for (const c of a.comments) console.log(`   ・${c}`);
check('分析コメントが生成される', a.comments.length >= 1);

{
  const ref = '2026-07-10';
  const base = emptyState();
  const subject = { id: 'subj_analytics', name: '数学', color: '#4f7cff', importance: 3, weakness: 3 } as const;
  const material: Material = {
    id: 'mat_analytics',
    subjectId: subject.id,
    name: '分析用問題集',
    unit: '問題',
    totalAmount: 10,
    doneAmount: 1,
    startDate: '2026-07-01',
    targetDate: '2026-07-11',
    priority: 3,
    difficulty: 3,
    minutesPerUnit: 10,
    dailyTarget: null,
    weeklyTarget: null,
    deadlinePolicy: 'normal',
    examRelevance: 3,
    reviewEnabled: false,
    reviewIntervals: [1, 3, 7],
    paused: false,
    round: 1,
    archived: false,
    createdAt: '2026-07-01T00:00:00.000Z',
  };
  const makeTask = (id: string, minutes: number, status: StudyTask['status']): StudyTask => ({
    id,
    subjectId: subject.id,
    materialId: material.id,
    title: material.name,
    rangeLabel: id,
    rangeStart: null,
    rangeEnd: null,
    amount: 1,
    estimatedMinutes: minutes,
    priority: 0,
    dueDate: null,
    type: 'new',
    status,
    scheduledDate: ref,
    scheduledStart: null,
    scheduledEnd: null,
    generatedBy: 'auto',
    memo: '',
    reviewStage: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    completedAt: status === 'done' ? '2026-07-10T00:00:00.000Z' : null,
  });
  const analyticsState: AppState = {
    ...base,
    onboarded: true,
    goal: { id: 'goal_analytics', name: '分析テスト', examDate: '2026-07-31', createdAt: '2026-07-01T00:00:00.000Z' },
    subjects: [subject],
    materials: [material],
    tasks: [makeTask('done_10min', 10, 'done'), makeTask('planned_90min', 90, 'planned')],
    sessions: [
      {
        id: 'sess_actual',
        taskId: 'done_10min',
        subjectId: subject.id,
        materialId: material.id,
        date: ref,
        startedAt: '2026-07-10T00:00:00.000Z',
        minutes: 10,
        amountDone: 1,
        rangeLabel: '',
        focus: 3,
        memo: '',
        source: 'manual',
      },
      {
        id: 'sess_future',
        taskId: null,
        subjectId: subject.id,
        materialId: material.id,
        date: '2026-07-11',
        startedAt: '2026-07-11T00:00:00.000Z',
        minutes: 999,
        amountDone: 9,
        rangeLabel: '',
        focus: 3,
        memo: '',
        source: 'manual',
      },
    ],
  };
  const analytics = computeAnalytics(analyticsState, ref);
  const stat = analytics.subjectStats[0];
  const forecast = analytics.materialForecasts[0];
  check('分析の予定達成率は件数ではなく予定分数ベース', analytics.planAchievementRate7d === 0.1, analytics.planAchievementRate7d);
  check('科目別達成率も予定分数ベース', stat.completionRate === 0.1, stat.completionRate);
  check('分析は基準日より未来の実績を集計しない', analytics.weekMinutes === 10 && stat.actualMinutes === 10, {
    weekMinutes: analytics.weekMinutes,
    actualMinutes: stat.actualMinutes,
  });
  check('教材ペース予測は未来実績を含めず、開始日からの実日数で割る', forecast.currentPacePerDay === 0.1, forecast);
  check('今日の必要量は今日と目標日を含む日数で割る', forecast.requiredPacePerDay === 4.5 && todayQuotaFor(analyticsState, material.id, ref) === 5, {
    requiredPacePerDay: forecast.requiredPacePerDay,
    quota: todayQuotaFor(analyticsState, material.id, ref),
  });
}

console.log('--- 実績バッジ ---');
{
  const badges = computeAchievements(state, t);
  check('バッジが定義されている', badges.length >= 10, badges.length);
  const first = badges.find((b) => b.id === 'first-session');
  check('「はじめの一歩」が獲得済み(デモは実績あり)', first?.unlocked === true);
  check('全バッジのprogressが0-1', badges.every((b) => b.progress >= 0 && b.progress <= 1));
  console.log(`  獲得: ${unlockedCount(badges)}/${badges.length} → ${badges.filter((b) => b.unlocked).map((b) => b.title).join(', ')}`);
  const empty = computeAchievements({ ...state, sessions: [], tasks: [], materials: [] }, t);
  check('データなしでは獲得0', unlockedCount(empty) === 0, unlockedCount(empty));
}

console.log('--- 「今日は無理」 ---');
const impossibleTasks = state.tasks.map((x) => (x.scheduledDate === t && x.status === 'planned' ? { ...x, status: 'postponed' as const, scheduledDate: addDays(t, 1) } : x));
const { state: s3 } = generatePlan({ ...state, tasks: impossibleTasks }, addDays(t, 1), '今日は無理');
const tomorrowMin = s3.tasks.filter((x) => x.scheduledDate === addDays(t, 1) && x.status !== 'done' && x.status !== 'skipped').reduce((s, x) => s + x.estimatedMinutes, 0);
check(`明日が過積載にならない (${tomorrowMin}分 <= ${availableMinutesOn(s3, addDays(t, 1))}分)`, tomorrowMin <= availableMinutesOn(s3, addDays(t, 1)));

console.log('--- 記録後も今日の残りタスクが維持される ---');
{
  const first = todayTasks[0];
  const tasksAfterDone = state.tasks.map((x) =>
    x.id === first.id ? { ...x, status: 'done' as const, completedAt: new Date().toISOString() } : x,
  );
  const pendingBefore = tasksAfterDone.filter((x) => x.scheduledDate === t && x.status === 'planned').map((x) => x.id);
  const { state: s4 } = generatePlan({ ...state, tasks: tasksAfterDone }, addDays(t, 1), '学習実績の反映');
  const pendingAfter = s4.tasks.filter((x) => x.scheduledDate === t && x.status === 'planned').map((x) => x.id);
  check(
    `今日の未完了タスクが消えない (前${pendingBefore.length}件 → 後${pendingAfter.length}件)`,
    pendingBefore.every((id) => pendingAfter.includes(id)),
  );
  // 明日以降に同じ教材範囲が二重配置されていないか(教材ごとの総担当量が残量以下)
  for (const m of s4.materials) {
    const claimed = s4.tasks
      .filter((x) => x.materialId === m.id && x.type === 'new' && (x.status === 'planned' || x.status === 'doing'))
      .reduce((sum, x) => sum + x.amount, 0);
    const rem = Math.max(0, m.totalAmount - m.doneAmount);
    if (claimed > rem) check(`${m.name}: 配置量${claimed} > 残量${rem} (二重配置)`, false);
  }
  console.log('  ✅ 教材範囲の二重配置なし');
}

console.log('--- タスク予定変更の不変条件 ---');
{
  const plannedTask = todayTasks[0];
  const doneTask = { ...plannedTask, status: 'done' as const, completedAt: new Date().toISOString(), dueDate: addDays(t, 2) };
  const base = { ...state, tasks: state.tasks.map((x) => (x.id === plannedTask.id ? doneTask : x)) };

  const movedDone = appReducer(base, { type: 'MOVE_TASK', taskId: doneTask.id, date: addDays(t, 1) });
  const movedDoneTask = movedDone.tasks.find((x) => x.id === doneTask.id);
  check('完了済みタスクはMOVE_TASKで動かない', movedDoneTask?.scheduledDate === doneTask.scheduledDate);

  const postponedDone = appReducer(base, { type: 'POSTPONE_TASK', taskId: doneTask.id });
  const postponedDoneTask = postponedDone.tasks.find((x) => x.id === doneTask.id);
  check('完了済みタスクはPOSTPONE_TASKで延期されない', postponedDoneTask?.scheduledDate === doneTask.scheduledDate && postponedDoneTask?.status === 'done');

  const dueTask = { ...todayTasks[1], dueDate: t };
  const dueBase = { ...state, tasks: state.tasks.map((x) => (x.id === dueTask.id ? dueTask : x)) };
  const movedPastDue = appReducer(dueBase, { type: 'MOVE_TASK', taskId: dueTask.id, date: addDays(t, 1) });
  const movedPastDueTask = movedPastDue.tasks.find((x) => x.id === dueTask.id);
  check('未来期限を越えるMOVE_TASKは拒否される', movedPastDueTask?.scheduledDate === dueTask.scheduledDate);

  const reviewCountBefore = base.tasks.filter((x) => x.type === 'review' && x.rangeLabel === doneTask.rangeLabel).length;
  const afterRepeatCompletion = appReducer(base, {
    type: 'RECORD_SESSION',
    input: {
      taskId: doneTask.id,
      subjectId: doneTask.subjectId,
      materialId: doneTask.materialId,
      minutes: doneTask.estimatedMinutes,
      amountDone: 0,
      focus: 3,
      memo: '',
      source: 'manual',
      rangeLabel: doneTask.rangeLabel,
      completedTask: true,
    },
  });
  const reviewCountAfter = afterRepeatCompletion.tasks.filter((x) => x.type === 'review' && x.rangeLabel === doneTask.rangeLabel).length;
  check('完了済みタスクの再記録で復習タスクが重複しない', reviewCountAfter === reviewCountBefore, { reviewCountBefore, reviewCountAfter });
}

console.log('--- タスク時刻補正 ---');
{
  const fixedNow = new Date('2026-07-09T03:02:00.000Z'); // Asia/Tokyo 12:02
  const pastTime = normalizeTaskSchedule('2026-07-09', '11:00', 30, { now: fixedNow });
  check('今日の過去時刻は現在+5分を5分刻みに丸める', pastTime.date === '2026-07-09' && pastTime.startTime === '12:10' && pastTime.endTime === '12:40', pastTime);

  const pastDate = normalizeTaskSchedule('2026-07-08', '10:00', 30, { now: fixedNow });
  check('過去日の予定は今日の未来時刻に丸める', pastDate.date === '2026-07-09' && pastDate.startTime === '12:10', pastDate);

  const overMidnight = normalizeTaskSchedule('2026-07-09', '23:40', 30, { now: fixedNow });
  check('日跨ぎになる予定は翌日9:00へ送る', overMidnight.date === '2026-07-10' && overMidnight.startTime === '09:00' && overMidnight.endTime === '09:30', overMidnight);
}

console.log('--- 固定予定・完了タスクとの時間帯重複防止 ---');
{
  const fixedNow = new Date('2026-07-09T01:00:00.000Z'); // JST 10:00
  const base = emptyState();
  const makeMat = (doneAmount: number): Material => ({
    id: 'mat_ov',
    subjectId: 'subj_ov',
    name: '問題集',
    unit: '問',
    totalAmount: 100,
    doneAmount,
    startDate: '2026-07-09',
    targetDate: '2026-08-31',
    priority: 3,
    difficulty: 3,
    minutesPerUnit: 10,
    dailyTarget: null,
    weeklyTarget: null,
    deadlinePolicy: 'normal',
    examRelevance: 3,
    reviewEnabled: false,
    reviewIntervals: [1, 3, 7],
    paused: false,
    round: 1,
    archived: false,
    createdAt: fixedNow.toISOString(),
  });
  const overlapState: AppState = {
    ...base,
    onboarded: true,
    goal: { id: 'g_ov', name: 'テスト', examDate: '2026-09-30', createdAt: fixedNow.toISOString() },
    subjects: [{ id: 'subj_ov', name: '数学', color: '#4f7cff', importance: 3, weakness: 3 }],
    materials: [makeMat(5)],
    availability: ([0, 1, 2, 3, 4, 5, 6] as const).map((weekday) => ({
      weekday,
      minutes: 120,
      windows: [{ start: '18:00', end: '20:00' }],
    })),
    settings: { ...base.settings, sessionMinMinutes: 25, sessionMaxMinutes: 90, maxDailyMinutes: 600 },
    tasks: [
      {
        id: 'task_done_ov',
        subjectId: 'subj_ov',
        materialId: 'mat_ov',
        title: '済みタスク',
        rangeLabel: '1〜5問',
        rangeStart: 1,
        rangeEnd: 5,
        amount: 5,
        estimatedMinutes: 50,
        priority: 50,
        dueDate: null,
        memo: '',
        type: 'new',
        status: 'done',
        scheduledDate: '2026-07-10',
        scheduledStart: '18:00',
        scheduledEnd: '18:50',
        generatedBy: 'auto',
        reviewStage: null,
        createdAt: fixedNow.toISOString(),
        completedAt: fixedNow.toISOString(),
      },
    ],
  };
  const replanned = generatePlan(overlapState, '2026-07-10', '重複検証', { now: fixedNow }).state;
  const dayTasks = replanned.tasks.filter((x) => x.scheduledDate === '2026-07-10' && x.scheduledStart && x.scheduledEnd);
  const toRange = (x: { scheduledStart: string | null; scheduledEnd: string | null }) => {
    const [sh, sm] = x.scheduledStart!.split(':').map(Number);
    const [eh, em] = x.scheduledEnd!.split(':').map(Number);
    return { start: sh * 60 + sm, end: eh * 60 + em };
  };
  const overlapping = dayTasks.filter((a) =>
    dayTasks.some((b) => {
      if (a.id === b.id) return false;
      const ra = toRange(a);
      const rb = toRange(b);
      return ra.start < rb.end && ra.end > rb.start;
    }),
  );
  check(
    '再計算で完了済みタスクの時間帯に新規タスクを重ねない',
    overlapping.length === 0,
    dayTasks.map((x) => `${x.status} ${x.scheduledStart}〜${x.scheduledEnd}`),
  );

  // REORDER_TASK: 固定予定(17:00〜18:00)を避けて詰め直す
  const mkTask = (id: string, start: string, end: string, minutes: number): (typeof overlapState.tasks)[number] => ({
    ...overlapState.tasks[0],
    id,
    status: 'planned',
    completedAt: null,
    estimatedMinutes: minutes,
    scheduledDate: '2026-07-12',
    scheduledStart: start,
    scheduledEnd: end,
  });
  const reorderState: AppState = {
    ...overlapState,
    availability: ([0, 1, 2, 3, 4, 5, 6] as const).map((weekday) => ({
      weekday,
      minutes: 360,
      windows: [{ start: '16:00', end: '22:00' }],
    })),
    fixedEvents: [{ id: 'ev_juku', title: '塾', weekday: null, date: '2026-07-12', start: '17:00', end: '18:00' }],
    tasks: [mkTask('t1', '16:00', '16:50', 50), mkTask('t2', '18:00', '18:50', 50), mkTask('t3', '19:00', '19:30', 30)],
  };
  const reordered = appReducer(reorderState, { type: 'REORDER_TASK', taskId: 't3', direction: 'up' });
  const jukuStart = 17 * 60;
  const jukuEnd = 18 * 60;
  const hitsEvent = reordered.tasks.filter((x) => {
    if (!x.scheduledStart || !x.scheduledEnd) return false;
    const r = toRange(x);
    return r.start < jukuEnd && r.end > jukuStart;
  });
  check(
    '並べ替え後の時刻が固定予定と重ならない',
    hitsEvent.length === 0,
    reordered.tasks.map((x) => `${x.id} ${x.scheduledStart}〜${x.scheduledEnd}`),
  );
}

console.log('--- 計画ロジックの品質(上書き・ピン留め・ローテーション・実績反映) ---');
{
  const fixedNow = new Date('2026-07-09T01:00:00.000Z'); // JST 10:00
  const base = emptyState();
  const makeMat = (id: string, name: string, over: Partial<Material> = {}): Material => ({
    id,
    subjectId: 'subj_q',
    name,
    unit: '問',
    totalAmount: 100,
    doneAmount: 0,
    startDate: '2026-07-09',
    targetDate: '2026-08-31',
    priority: 3,
    difficulty: 3,
    minutesPerUnit: 30,
    dailyTarget: null,
    weeklyTarget: null,
    deadlinePolicy: 'normal',
    examRelevance: 3,
    reviewEnabled: false,
    reviewIntervals: [1, 3, 7],
    paused: false,
    round: 1,
    archived: false,
    createdAt: fixedNow.toISOString(),
    ...over,
  });
  const qState: AppState = {
    ...base,
    onboarded: true,
    goal: { id: 'g_q', name: 'テスト', examDate: '2026-09-30', createdAt: fixedNow.toISOString() },
    subjects: [{ id: 'subj_q', name: '数学', color: '#4f7cff', importance: 3, weakness: 3 }],
    materials: [makeMat('mat_q', '問題集Q')],
    availability: ([0, 1, 2, 3, 4, 5, 6] as const).map((weekday) => ({
      weekday,
      minutes: 120,
      windows: [{ start: '18:00', end: '20:00' }],
    })),
    settings: { ...base.settings, sessionMinMinutes: 25, sessionMaxMinutes: 90, maxDailyMinutes: 600 },
  };

  // 1. 日別例外の時間帯上書きで容量が「広がる」方向にも効く
  const overrideState: AppState = {
    ...qState,
    dayPlans: [{ date: '2026-07-12', load: 'normal', memo: '', availabilityWindows: [{ start: '09:00', end: '21:00' }] }],
  };
  check(
    '日別例外の時間帯上書きで勉強可能時間が広がる(120分→600分)',
    availableMinutesOn(overrideState, '2026-07-12') === 600,
    availableMinutesOn(overrideState, '2026-07-12'),
  );
  check('上書きなしの日は従来通り', availableMinutesOn(qState, '2026-07-12') === 120);

  // 2. 手動で日時指定したタスクは再設計で動かない
  const pinned: StudyTask = {
    id: 'task_pin',
    subjectId: 'subj_q',
    materialId: null,
    title: '模試の復習',
    rangeLabel: '',
    rangeStart: null,
    rangeEnd: null,
    amount: 1,
    estimatedMinutes: 30,
    priority: 60,
    dueDate: '2026-07-20',
    memo: '',
    type: 'new',
    status: 'planned',
    scheduledDate: '2026-07-15',
    scheduledStart: '18:30',
    scheduledEnd: '19:00',
    generatedBy: 'manual',
    reviewStage: null,
    createdAt: fixedNow.toISOString(),
    completedAt: null,
  };
  const pinnedAfter = generatePlan({ ...qState, tasks: [pinned] }, '2026-07-10', '再設計', { now: fixedNow }).state.tasks.find(
    (x) => x.id === 'task_pin',
  );
  check(
    '手動固定タスクは再設計で日付・時刻が動かない',
    pinnedAfter?.scheduledDate === '2026-07-15' && pinnedAfter?.scheduledStart === '18:30',
    pinnedAfter,
  );

  // 3. 時刻固定は固定予定と衝突しても無言で動かさない
  const pinnedConflictState: AppState = {
    ...qState,
    tasks: [pinned],
    fixedEvents: [{ id: 'ev_q', title: '塾', weekday: null, date: '2026-07-15', start: '18:00', end: '19:00' }],
  };
  const conflictAfter = generatePlan(pinnedConflictState, '2026-07-10', '固定予定の変更', { now: fixedNow }).state.tasks.find(
    (x) => x.id === 'task_pin',
  );
  check(
    '時刻固定タスクと固定予定の衝突は固定を維持してconflictにする',
    conflictAfter?.scheduledDate === '2026-07-15' && conflictAfter?.scheduledStart === '18:30' && conflictAfter.placementStatus === 'conflict',
    conflictAfter,
  );

  // 4. 同一教材が連続ブロックで選ばれない(代替教材がある場合のインターリービング)
  const rotationState: AppState = {
    ...qState,
    materials: [makeMat('mat_r1', 'A問題集'), makeMat('mat_r2', 'B問題集'), makeMat('mat_r3', 'C問題集')],
    availability: ([0, 1, 2, 3, 4, 5, 6] as const).map((weekday) => ({
      weekday,
      minutes: 450,
      windows: [{ start: '09:00', end: '16:30' }],
    })),
    settings: { ...qState.settings, maxDailyMinutes: 450 },
  };
  const rotated = generatePlan(rotationState, '2026-07-10', 'ローテーション検証', { now: fixedNow }).state;
  const rotDays = ['2026-07-10', '2026-07-11', '2026-07-12'];
  let adjacentSame = 0;
  for (const d of rotDays) {
    const ordered = rotated.tasks
      .filter((x) => x.scheduledDate === d && x.scheduledStart)
      .sort((a, b) => a.scheduledStart!.localeCompare(b.scheduledStart!));
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i].materialId && ordered[i].materialId === ordered[i - 1].materialId) adjacentSame += 1;
    }
  }
  check(
    '代替教材がある日は同一教材が連続ブロックにならない',
    adjacentSame === 0,
    rotated.tasks
      .filter((x) => rotDays.includes(x.scheduledDate))
      .map((x) => `${x.scheduledDate} ${x.scheduledStart} ${x.title}`),
  );

  // 5. 過去時間は現在時刻で除外済みなので、実績を未来容量から二重減算しない
  const freeSession: StudySession = {
    id: 'sess_free',
    taskId: null,
    subjectId: 'subj_q',
    materialId: null,
    date: '2026-07-09',
    startedAt: fixedNow.toISOString(),
    minutes: 60,
    amountDone: 0,
    rangeLabel: '自由学習',
    focus: 3,
    memo: '',
    source: 'timer',
  };
  const withFree = generatePlan({ ...qState, sessions: [freeSession] }, '2026-07-09', '実績反映', { now: fixedNow }).state;
  const todayPlannedMin = withFree.tasks
    .filter((x) => x.scheduledDate === '2026-07-09' && x.status === 'planned')
    .reduce((sum, x) => sum + x.estimatedMinutes, 0);
  check(
    `過去のフリー実績を未来容量から二重減算しない(予定${todayPlannedMin}分 <= 120分)`,
    todayPlannedMin <= 120,
    todayPlannedMin,
  );

  // 6. 期間付きの毎週固定予定
  const rangedEventState: AppState = {
    ...qState,
    fixedEvents: [
      {
        id: 'ev_range',
        title: '夏期講習',
        weekday: 2,
        date: null,
        startDate: '2026-07-14',
        endDate: '2026-07-20',
        start: '18:00',
        end: '19:00',
      },
    ],
  };
  check('期間付き毎週予定は範囲内の曜日だけ有効', fixedEventsOn(rangedEventState, '2026-07-14').length === 1);
  check('期間付き毎週予定は範囲外の同じ曜日には出ない', fixedEventsOn(rangedEventState, '2026-07-21').length === 0);
}

console.log('--- V2 制約・決定性 ---');
{
  const fixedNow = new Date('2026-07-09T23:00:00.000Z'); // JST 08:00
  const subject = { id: 'v2_subject', name: '数学', color: '#4f7cff', importance: 3, weakness: 3 } as const;
  const baseMaterial = (id: string, totalAmount: number, minutesPerUnit: number, over: Partial<Material> = {}): Material => ({
    id,
    subjectId: subject.id,
    name: id,
    unit: '問題',
    totalAmount,
    totalUnits: totalAmount,
    doneAmount: 0,
    completedRanges: [],
    startDate: '2026-07-10',
    targetDate: '2026-07-10',
    priority: 3,
    difficulty: 3,
    minutesPerUnit,
    unitStep: 1,
    splittable: true,
    preferredCadence: { type: 'auto' },
    dailyTarget: null,
    weeklyTarget: null,
    deadlinePolicy: 'strict',
    examRelevance: 3,
    reviewEnabled: false,
    reviewIntervals: [1, 3, 7],
    paused: false,
    round: 1,
    archived: false,
    createdAt: fixedNow.toISOString(),
    ...over,
  });
  const v2State = (materials: Material[], windows: { start: string; end: string }[], minutes: number): AppState => ({
    ...emptyState(),
    onboarded: true,
    subjects: [subject],
    materials,
    availability: ([0, 1, 2, 3, 4, 5, 6] as const).map((weekday) => ({ weekday, minutes, windows })),
    settings: { ...emptyState().settings, maxDailyMinutes: minutes, sessionMinMinutes: 5, sessionMaxMinutes: 90, taskGenerationHorizonDays: 1 },
  });
  const context = { now: fixedNow, timezone: 'Asia/Tokyo', generationId: 'v2-test' };

  const shortage = generatePlanV2(v2State([
    baseMaterial('strict_a', 6, 60),
    baseMaterial('strict_b', 6, 60),
  ], [{ start: '09:00', end: '19:00' }], 600), context);
  check('V2: 厳守課題は個別でなく合計容量を判定する', shortage.status === 'infeasible');
  check('V2: 合計容量不足を120分と報告する', shortage.objectiveReport.unscheduledStrictMinutes === 120, shortage.objectiveReport);

  const indivisible = generatePlanV2(v2State([
    baseMaterial('indivisible', 1, 60, { splittable: false }),
  ], [{ start: '09:00', end: '09:30' }, { start: '10:00', end: '10:30' }], 60), context);
  check('V2: 30分+30分へ60分の分割不可課題を置かない', indivisible.status === 'infeasible');

  const minimumChunk = generatePlanV2(v2State([
    baseMaterial('minimum_chunk', 3, 20, { minimumChunkUnits: 2 }),
  ], [{ start: '09:00', end: '09:30' }, { start: '10:00', end: '10:30' }], 60), context);
  check('V2: 最小40分チャンクを30分枠へ置かない', minimumChunk.status === 'infeasible');

  const splittable = generatePlanV2(v2State([
    baseMaterial('splittable', 2, 30, { minimumChunkUnits: 1 }),
  ], [{ start: '09:00', end: '09:30' }, { start: '10:00', end: '10:30' }], 60), context);
  check('V2: 最小30分なら30分枠2つへ分割できる', splittable.status === 'success' && splittable.scheduledTasks.length === 2, splittable);
  check('V2: 同一入力・時刻・generationIdの結果が完全一致', JSON.stringify(splittable) === JSON.stringify(generatePlanV2(v2State([
    baseMaterial('splittable', 2, 30, { minimumChunkUnits: 1 }),
  ], [{ start: '09:00', end: '09:30' }, { start: '10:00', end: '10:30' }], 60), context)));

  const normalizedRanges = normalizeUnitRanges([{ start: 5, end: 8 }, { start: 1, end: 3 }, { start: 4, end: 4 }], 10);
  check('V2: 重複・接触する完了範囲を統合する', JSON.stringify(normalizedRanges) === JSON.stringify([{ start: 1, end: 8 }]));
  check('V2: 未完了範囲を抽出する', JSON.stringify(remainingUnitRanges(10, normalizedRanges)) === JSON.stringify([{ start: 9, end: 10 }]));

  const estimateMaterial = baseMaterial('estimate', 10, 10, { estimateMode: 'auto' });
  const estimateSessions: StudySession[] = [10, 12, 14, 1000].map((minutes, index) => ({
    id: `estimate_${index}`,
    taskId: null,
    subjectId: subject.id,
    materialId: estimateMaterial.id,
    date: '2026-07-10',
    startedAt: fixedNow.toISOString(),
    minutes,
    amountDone: 1,
    rangeLabel: '',
    focus: 3,
    memo: '',
    source: 'manual',
  }));
  const estimate = updateMinutesPerUnitEstimate(estimateMaterial, estimateSessions);
  check('V2: 3件以上で外れ値を除外して見積補正する', estimate.applied && estimate.excludedCount === 1, estimate);
  check('V2: 1回の見積変化を15%以内に制限する', estimate.appliedEstimate >= 8.5 && estimate.appliedEstimate <= 11.5, estimate);

  let propertyOk = true;
  let seed = 0x12345678;
  for (let i = 0; i < 10_000; i += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const a = seed % 1200;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const b = a + 1 + (seed % 180);
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const c = seed % 1200;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const d = c + 1 + (seed % 180);
    const merged = mergeMinuteRanges([{ start: a, end: b }, { start: c, end: d }]);
    if (merged.some((range, index) => range.start >= range.end || (index > 0 && merged[index - 1].end >= range.start))) {
      propertyOk = false;
      break;
    }
  }
  check('V2: 区間統合のプロパティベース検証 10,000ケース', propertyOk);
}

console.log(failures === 0 ? '\n🎉 ALL PASS' : `\n💥 ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
