/** 配置コアの外側で起きた重大回帰のテスト。 */
/// <reference types="node" />
import { addDays, localDateTimeToISOString, minutesToHM, today, toISODate } from '../src/lib/date';
import { computeAnalytics } from '../src/lib/analytics';
import { computeCapacity, computeDayStatus, generatePlan, subjectAchievementMap } from '../src/lib/scheduler';
import { clearOwnedState, normalizeState, saveState, saveStateNow, subscribeStateSaveFailure } from '../src/lib/storage';
import { actualMaterialAmountThrough, isPlacedPlanTask, legacyProgressBaselineRanges, plannedMaterialAmountThrough } from '../src/lib/taskFilters';
import { adjustCompletedRanges, appReducer, createUndoEntry, emptyState, isUndoEntryValid, UNDO_WINDOW_MS } from '../src/state/AppContext';
import { parseNumericDraft, sanitizeNumericDraft } from '../src/components/ui/bits';
import { mergeStudySettings, mergeTimerSettings, reconcileSectionDraft, studySettingsDraft } from '../src/lib/settingsSections';
import { validateMaterialDates } from '../src/lib/materialValidation';
import { plannedTaskCompletionRate } from '../src/screens/TodayScreen';
import type { AppState, Material, StudySession, StudyTask } from '../src/types';

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.log(`  ❌ ${name}`, detail ?? '');
  }
}

const ref = today();
const tomorrow = addDays(ref, 1);
const subject = { id: 'subject', name: '数学', color: '#4f7cff', importance: 3, weakness: 3 } as const;
const material: Material = {
  id: 'material', subjectId: subject.id, name: '問題集', unit: '問題', totalAmount: 100, totalUnits: 100,
  doneAmount: 0, completedRanges: [], startDate: ref, targetDate: addDays(ref, 30), priority: 3, difficulty: 3,
  minutesPerUnit: 10, unitStep: 1, splittable: true, preferredCadence: { type: 'auto' }, dailyTarget: null,
  weeklyTarget: null, deadlinePolicy: 'normal', examRelevance: 3, reviewEnabled: false, reviewIntervals: [1, 3, 7],
  paused: false, round: 1, archived: false, createdAt: new Date().toISOString(),
};
function task(over: Partial<StudyTask> = {}): StudyTask {
  return {
    id: 'task', subjectId: subject.id, materialId: material.id, title: '問題集', rangeLabel: '10〜20',
    rangeStart: 10, rangeEnd: 20, materialRange: { start: 10, end: 20 }, amount: 11, estimatedMinutes: 110,
    priority: 50, dueDate: null, type: 'new', status: 'planned', scheduledDate: ref, scheduledStart: '18:00',
    scheduledEnd: '19:50', generatedBy: 'auto', reviewStage: null, createdAt: new Date().toISOString(), completedAt: null,
    sourceType: 'material', sourceId: material.id, placementStatus: 'scheduled', placementLock: 'none',
    ...over,
  };
}
function state(over: Partial<AppState> = {}): AppState {
  const base = emptyState();
  return {
    ...base,
    onboarded: true,
    subjects: [subject],
    materials: [material],
    tasks: [task()],
    availability: ([0, 1, 2, 3, 4, 5, 6] as const).map((weekday) => ({ weekday, minutes: 300, windows: [{ start: '09:00', end: '14:00' }] })),
    settings: { ...base.settings, maxDailyMinutes: 300, taskGenerationHorizonDays: 7 },
    ...over,
  };
}
const record = (completedTask: boolean, amountDone: number) => ({
  type: 'RECORD_SESSION' as const,
  input: {
    taskId: 'task', subjectId: subject.id, materialId: material.id, minutes: 20, amountDone, focus: 3 as const,
    memo: '', source: 'manual' as const, rangeLabel: '10〜20', completedTask,
  },
});

console.log('--- 記録範囲と実績量 ---');
{
  const partial = appReducer(state(), record(false, 2));
  const done = partial.materials[0].completedRanges ?? [];
  check('途中まで2問ならタスク先頭の10〜11だけ完了', done.length === 1 && done[0].start === 10 && done[0].end === 11, done);
  check('途中記録のセッション量も2のまま', partial.sessions.at(-1)?.amountDone === 2, partial.sessions.at(-1));
  const remainingTask = partial.tasks.find((item) => item.id === 'task');
  check('途中記録後の元タスクは未完了の12〜20へ縮む', remainingTask?.rangeStart === 12 && remainingTask.rangeEnd === 20 && remainingTask.amount === 9, remainingTask);
  check('途中記録後の予定時間も残量比で90分へ縮む', remainingTask?.estimatedMinutes === 90, remainingTask);

  const complete = appReducer(state(), record(true, 2));
  const completeRanges = complete.materials[0].completedRanges ?? [];
  check('完了を選んだ場合だけ10〜20全範囲を完了', completeRanges.length === 1 && completeRanges[0].start === 10 && completeRanges[0].end === 20, completeRanges);
  check('完了セッション量は実際に完了した11問へ正規化', complete.sessions.at(-1)?.amountDone === 11, complete.sessions.at(-1));

  const almostDone = { ...material, doneAmount: 95, completedRanges: [{ start: 1, end: 95 }] };
  const free = appReducer(state({ materials: [almostDone], tasks: [] }), {
    type: 'RECORD_SESSION',
    input: { ...record(false, 100).input, taskId: null, amountDone: 100, rangeLabel: '自由記録' },
  });
  check('残り5問に対する100問入力はセッションも5へ制限', free.sessions.at(-1)?.amountDone === 5, free.sessions.at(-1));
  check('残量超過入力でも教材進捗は100で止まる', free.materials[0].doneAmount === 100, free.materials[0]);

  // タイマー開始後の再計算でauto taskのIDだけが変わったケース。
  const regenerated = task({ id: 'task_after_replan', sourceId: material.id });
  const recovered = appReducer(state({ tasks: [regenerated] }), {
    type: 'RECORD_SESSION',
    input: {
      ...record(true, 0).input,
      taskId: 'task_before_replan',
      taskLocator: { sourceId: material.id, range: { start: 10, end: 20 }, type: 'new' },
    },
  });
  check('再計算でIDが変わったタイマー記録も現行タスクを完了にする', recovered.tasks.some((item) => item.id === regenerated.id && item.status === 'done'), recovered.tasks);
}

console.log('--- 教材進捗編集・固定状態 ---');
{
  check('開始日が期限より後なら教材を保存しない判定', validateMaterialDates('2026-02-02', '2026-02-01') !== null);
  check('推奨完了日が期間外なら教材を保存しない判定', validateMaterialDates('2026-02-01', '2026-02-10', '2026-02-11') !== null);
  check('既存教材の過去期限同士は日付順が正しければ許可', validateMaterialDates('2020-01-01', '2020-02-01', '2020-01-20') === null);
  check('教材期限が試験日より後なら保存しない判定', validateMaterialDates('2026-02-01', '2026-03-02', undefined, '2026-03-01') !== null);
  const rejectedMaterial = appReducer(state({ goal: { id: 'goal-date', name: '試験', examDate: addDays(ref, 20), createdAt: new Date().toISOString() } }), {
    type: 'UPDATE_MATERIAL',
    material: { ...material, targetDate: addDays(ref, 21) },
  });
  check('Reducerも試験日より後の教材期限を拒否', rejectedMaterial.materials[0].targetDate === material.targetDate, rejectedMaterial.materials[0]);
  const rejectedGoal = appReducer(state({ goal: { id: 'goal-date', name: '試験', examDate: addDays(ref, 40), createdAt: new Date().toISOString() } }), {
    type: 'UPDATE_GOAL',
    goal: { id: 'goal-date', name: '試験', examDate: addDays(ref, 20), createdAt: new Date().toISOString() },
  });
  check('Reducerは有効教材より前への試験日短縮を拒否', rejectedGoal.goal?.examDate === addDays(ref, 40), rejectedGoal.goal);
  const adjusted = adjustCompletedRanges(100, [{ start: 1, end: 5 }, { start: 20, end: 24 }], 11);
  check('進捗量を増やしても非連続の完了範囲を保持', JSON.stringify(adjusted) === JSON.stringify([{ start: 1, end: 6 }, { start: 20, end: 24 }]), adjusted);

  const manual = task({
    id: 'move-manual', materialId: null, generatedBy: 'manual', sourceType: 'manual', sourceId: 'move-manual',
    manualScheduling: { placementPolicy: 'fixedTime', fixedDate: ref, fixedStartTime: '18:00', progressPolicy: { type: 'independent' }, splittable: false },
    placementLock: 'time',
  });
  const moved = appReducer(state({ materials: [], tasks: [manual] }), { type: 'MOVE_TASK', taskId: manual.id, date: tomorrow });
  const movedTask = moved.tasks.find((item) => item.id === manual.id);
  check('MOVE_TASKはplacementLockとmanualSchedulingを同じ日付固定へ揃える', movedTask?.placementLock === 'date'
    && movedTask.manualScheduling?.placementPolicy === 'fixedDateFlexibleTime'
    && movedTask.manualScheduling.fixedDate === tomorrow
    && movedTask.manualScheduling.fixedStartTime === undefined, movedTask);
}

console.log('--- 延期・今日は無理 ---');
{
  const manual = task({
    id: 'manual', materialId: null, rangeStart: null, rangeEnd: null, materialRange: undefined, amount: 1,
    title: '小論文', rangeLabel: '', estimatedMinutes: 60, generatedBy: 'manual', sourceType: 'manual', sourceId: 'manual',
    placementLock: 'time', manualScheduling: {
      placementPolicy: 'fixedTime', fixedDate: ref, fixedStartTime: '18:00', progressPolicy: { type: 'independent' }, splittable: false,
    },
  });
  const postponed = appReducer(state({ materials: [], tasks: [manual] }), { type: 'POSTPONE_TASK', taskId: manual.id });
  const kept = postponed.tasks.find((item) => item.id === manual.id || item.sourceId === manual.id);
  check('手動タスクは延期後も計画から消えない', !!kept, postponed.tasks);
  check('延期タスクはplannedのまま翌日へ渡る', kept?.status === 'planned' && kept.scheduledDate === tomorrow, kept);
  check('延期で古い時刻固定を持ち越さない', kept?.placementLock !== 'time' && kept?.scheduledStart !== '18:00', kept);

  const impossible = appReducer(state({ materials: [], tasks: [manual] }), { type: 'TODAY_IMPOSSIBLE' });
  const keptImpossible = impossible.tasks.find((item) => item.id === manual.id || item.sourceId === manual.id);
  check('今日は無理でも手動タスクが消えない', !!keptImpossible && keptImpossible.status === 'planned', impossible.tasks);
}

console.log('--- 並び替え・メモ・設定 ---');
{
  const first = task({ id: 'first', scheduledStart: '18:00', scheduledEnd: '18:30', estimatedMinutes: 30, placementLock: 'none' });
  const second = task({ id: 'second', scheduledStart: '18:30', scheduledEnd: '19:00', estimatedMinutes: 30, placementLock: 'date' });
  const original = state({ tasks: [first, second] });
  const reordered = appReducer(original, { type: 'REORDER_TASK', taskId: second.id, direction: 'up' });
  const afterFirst = reordered.tasks.find((item) => item.id === first.id)!;
  const afterSecond = reordered.tasks.find((item) => item.id === second.id)!;
  check('並び替えで時刻を変更しない', afterFirst.scheduledStart === first.scheduledStart && afterSecond.scheduledStart === second.scheduledStart, reordered.tasks);
  check('並び替えで固定状態を変更しない', afterFirst.placementLock === 'none' && afterSecond.placementLock === 'date', reordered.tasks);
  check('並び替えは表示順だけを保存', afterSecond.manualOrder === 0 && afterFirst.manualOrder === 1, reordered.tasks);

  const memo = appReducer(original, { type: 'UPDATE_DAY_MEMO', date: ref, memo: '模試' });
  check('メモ保存ではタスク配列を再生成しない', memo.tasks === original.tasks && memo.dayPlans[0]?.memo === '模試');
  const themed = appReducer(original, { type: 'UPDATE_SETTINGS', settings: { ...original.settings, theme: 'dark' } });
  check('テーマ変更では計画を再生成しない', themed.tasks === original.tasks && themed.settings.theme === 'dark');
}

console.log('--- 表示・分析・容量 ---');
{
  const visible = task({ id: 'visible', estimatedMinutes: 60 });
  const hidden = task({ id: 'hidden', estimatedMinutes: 600, placementStatus: 'unscheduled' });
  const postponed = task({ id: 'postponed', estimatedMinutes: 600, status: 'postponed' });
  check('共通フィルターは未配置と延期を除外', isPlacedPlanTask(visible) && !isPlacedPlanTask(hidden) && !isPlacedPlanTask(postponed));
  const completionTasks = [task({ id: 'completion-done', status: 'done' }), task({ id: 'completion-pending', status: 'planned' })];
  check('今日の達成率は予定タスクの完了件数で計算', plannedTaskCompletionRate(completionTasks) === 0.5, plannedTaskCompletionRate(completionTasks));
  check('予定がない日は無関係な学習時間で100%扱いにしない', plannedTaskCompletionRate([]) === 0);
  const duplicate = task({ id: 'duplicate', scheduledDate: visible.scheduledDate });
  check('目標グラフ用の教材範囲は重複タスクを和集合で数える', plannedMaterialAmountThrough([visible, duplicate, hidden], material.id, material.totalAmount, ref) === 11);
  check('旧データの初期進捗と完了タスク範囲を二重計上しない', plannedMaterialAmountThrough(
    [task({ id: 'old-done', status: 'done', rangeStart: 1, rangeEnd: 20, materialRange: { start: 1, end: 20 }, amount: 20 })],
    material.id,
    material.totalAmount,
    ref,
    [{ start: 1, end: 20 }],
  ) === 20);
  const unrangedRescheduled = task({
    id: 'manual-unranged', rangeStart: null, rangeEnd: null, materialRange: undefined, amount: 3,
    scheduledDate: tomorrow, generatedBy: 'manual', sourceType: 'manual', sourceId: 'manual-unranged',
  });
  const unrangedHistory = [{
    id: `missed:${unrangedRescheduled.id}:${ref}`, taskId: unrangedRescheduled.id, subjectId: subject.id,
    materialId: material.id, title: unrangedRescheduled.title, scheduledDate: ref, estimatedMinutes: 30,
    amount: 3, type: 'new' as const, outcome: 'missed' as const, rangeStart: null, rangeEnd: null,
    capturedAt: new Date().toISOString(),
  }];
  check('範囲なし手動タスクの再配置は履歴と現行予定を二重計上しない', plannedMaterialAmountThrough(
    [unrangedRescheduled], material.id, material.totalAmount, tomorrow, [], unrangedHistory,
  ) === 3);
  const progressMaterial: Material = { ...material, doneAmount: 10, completedRanges: [{ start: 1, end: 10 }] };
  const exactSessions: StudySession[] = [
    { id: 'legacy-progress', taskId: null, subjectId: subject.id, materialId: material.id, date: addDays(ref, -3), startedAt: `${addDays(ref, -3)}T09:00:00.000Z`, minutes: 20, amountDone: 4, rangeLabel: '', focus: 3, memo: '', source: 'manual' },
    { id: 'exact-progress-a', taskId: null, subjectId: subject.id, materialId: material.id, date: addDays(ref, -2), startedAt: `${addDays(ref, -2)}T09:00:00.000Z`, minutes: 20, amountDone: 4, rangeLabel: '', focus: 3, memo: '', source: 'manual', progressRangesAdded: [{ start: 5, end: 8 }] },
    { id: 'exact-progress-b', taskId: null, subjectId: subject.id, materialId: material.id, date: addDays(ref, -1), startedAt: `${addDays(ref, -1)}T09:00:00.000Z`, minutes: 20, amountDone: 4, rangeLabel: '', focus: 3, memo: '', source: 'manual', progressRangesAdded: [{ start: 7, end: 10 }] },
  ];
  check('旧セッション分は現在完了範囲の基準量として一度だけ保持', JSON.stringify(legacyProgressBaselineRanges(progressMaterial, exactSessions)) === JSON.stringify([{ start: 1, end: 4 }]), legacyProgressBaselineRanges(progressMaterial, exactSessions));
  check('実績グラフは重複する進捗範囲を和集合で数える', actualMaterialAmountThrough(progressMaterial, exactSessions, addDays(ref, -1)) === 10, actualMaterialAmountThrough(progressMaterial, exactSessions, addDays(ref, -1)));
  check('実績グラフは後日の進捗を過去へ逆算しない', actualMaterialAmountThrough(progressMaterial, exactSessions, addDays(ref, -2)) === 8, actualMaterialAmountThrough(progressMaterial, exactSessions, addDays(ref, -2)));
  const analytics = computeAnalytics(state({ tasks: [visible, hidden, postponed] }), ref);
  check('分析の予定分数は表示対象だけを集計', analytics.subjectStats[0].plannedMinutes === 60, analytics.subjectStats[0]);

  const manual = task({ id: 'capacity-manual', materialId: null, generatedBy: 'manual', sourceType: 'manual', estimatedMinutes: 90 });
  const noMaterials = state({ materials: [], tasks: [manual], goal: { id: 'goal', name: '試験', examDate: ref, createdAt: new Date().toISOString() } });
  const late = new Date(`${ref}T14:00:00+09:00`);
  const capacity = computeCapacity(noMaterials, ref, late);
  check('独立した手動newタスクも残り学習量へ含む', capacity.totalRemainingMinutes === 90, capacity);
  check('当日の終了済み時間帯を残り容量へ含めない', capacity.totalAvailableMinutes === 0, capacity);

  const polluted = state({ tasks: [
    task({ id: 'done', scheduledDate: addDays(ref, -1), status: 'done' }),
    task({ id: 'postponed-old', scheduledDate: addDays(ref, -1), status: 'postponed' }),
    task({ id: 'conflict-old', scheduledDate: addDays(ref, -1), placementStatus: 'conflict' }),
  ] });
  check('科目達成率は延期・衝突残骸を予定件数へ含めない', subjectAchievementMap(polluted, ref).get(subject.id) === 1, subjectAchievementMap(polluted, ref));

  const pausedBehind = state({
    materials: [{ ...material, paused: true, startDate: addDays(ref, -20), doneAmount: 0, completedRanges: [] }],
    tasks: [],
    goal: { id: 'paused-goal', name: '試験', examDate: addDays(ref, 60), createdAt: new Date().toISOString() },
  });
  check('一時停止教材は今日の遅れ判定へ含めない', computeDayStatus(pausedBehind, ref) !== 'slightlyBehind', computeDayStatus(pausedBehind, ref));

  const conflict = task({ placementLock: 'time', scheduledStart: '01:00', scheduledEnd: '02:50' });
  const conflictedPlan = generatePlan(state({ tasks: [conflict] }), ref, 'capacity conflict', { now: new Date(`${ref}T12:00:00+09:00`) });
  check('固定衝突がある計画は旧capacity.okをtrueにしない', conflictedPlan.result.capacity.ok === false, conflictedPlan.result.capacity);
}

console.log('--- 再計算後の未達成履歴 ---');
{
  const pastDate = addDays(ref, -1);
  const pastTask = task({ id: 'missed-task', scheduledDate: pastDate, scheduledStart: '09:00', scheduledEnd: '10:00', estimatedMinutes: 60, amount: 6, rangeStart: 10, rangeEnd: 15, materialRange: { start: 10, end: 15 } });
  const first = generatePlan(state({ tasks: [pastTask] }), ref, '未達成履歴テスト', { now: new Date(`${ref}T08:00:00+09:00`), generationId: 'missed-history-1' }).state;
  const history = first.planHistory ?? [];
  check('再計算前の過去未達成タスクを履歴へ退避', history.length === 1
    && history[0].taskId === pastTask.id
    && history[0].scheduledDate === pastDate
    && history[0].estimatedMinutes === 60, history);
  const second = generatePlan(first, ref, '未達成履歴再計算テスト', { now: new Date(`${ref}T08:05:00+09:00`), generationId: 'missed-history-2' }).state;
  check('再計算を繰り返しても同じ未達成履歴を重複させない', (second.planHistory ?? []).length === 1, second.planHistory);

  const doneTask = task({ id: 'done-history-task', scheduledDate: pastDate, scheduledStart: '10:00', scheduledEnd: '11:00', estimatedMinutes: 60, status: 'done', completedAt: `${pastDate}T11:00:00+09:00` });
  const withDoneAndMissed = state({ tasks: [doneTask], planHistory: history });
  const summary = computeAnalytics(withDoneAndMissed, ref);
  check('分析の予定達成率は再計算後も未達成履歴を分母へ残す', summary.planAchievementRate7d === 0.5, summary.planAchievementRate7d);
  check('科目別達成率も未達成履歴を分母へ残す', summary.subjectStats[0].completionRate === 0.5, summary.subjectStats[0]);

  const manualPast = task({
    id: 'manual-reused', materialId: null, sourceType: 'manual', sourceId: 'manual-reused', generatedBy: 'manual',
    scheduledDate: pastDate, scheduledStart: '11:00', scheduledEnd: '12:00', estimatedMinutes: 60, amount: 1,
    rangeStart: null, rangeEnd: null, materialRange: undefined, manualScheduling: { placementPolicy: 'flexibleBeforeDeadline', deadline: addDays(ref, 2), progressPolicy: { type: 'independent' }, splittable: false },
  });
  const manualReplanned = generatePlan(state({ materials: [], tasks: [manualPast] }), ref, '手動未達成履歴テスト', { now: new Date(`${ref}T08:00:00+09:00`), generationId: 'manual-history' }).state;
  check('同じIDの手動タスクを未来へ再配置しても過去予定を履歴へ保持', (manualReplanned.planHistory ?? []).some((entry) => entry.taskId === manualPast.id && entry.scheduledDate === pastDate)
    && manualReplanned.tasks.some((entry) => entry.id === manualPast.id && entry.scheduledDate >= ref), { history: manualReplanned.planHistory, tasks: manualReplanned.tasks });
}

console.log('--- 初期設定の時間帯 ---');
{
  const initialized = appReducer(emptyState(), {
    type: 'COMPLETE_ONBOARDING',
    input: {
      goalName: '試験',
      examDate: addDays(ref, 30),
      subjects: [{ name: '数学', color: '#4f7cff', importance: 3, weakness: 3 }],
      weekdayMinutes: 720,
      weekendMinutes: 720,
      materials: [],
    },
  });
  const weekday = initialized.availability.find((slot) => slot.weekday === 1)!;
  const weekend = initialized.availability.find((slot) => slot.weekday === 0)!;
  check('初期設定の長時間入力でも日付をまたぐ無効時間帯を作らない',
    weekday.windows.length === 1
      && weekday.windows[0].start < weekday.windows[0].end
      && weekend.windows.length === 1
      && weekend.windows[0].start < weekend.windows[0].end,
    initialized.availability,
  );
  check('初期設定の分数は実際の時間帯へクランプ', weekday.minutes <= 359 && weekend.minutes <= 899, initialized.availability);
  check('分丸めで00:60を生成しない', minutesToHM(59.8) === '01:00', minutesToHM(59.8));
  const instant = new Date('2026-07-14T00:30:00.000Z');
  check('日付変換は指定タイムゾーンを正しく反映', toISODate(instant, 'Asia/Tokyo') === '2026-07-14' && toISODate(instant, 'America/Los_Angeles') === '2026-07-13');
  check('日本時間で入力した記録時刻を端末タイムゾーンに依存せずUTCへ変換', localDateTimeToISOString('2026-07-14', '09:30') === '2026-07-14T00:30:00.000Z');
  const legacy = normalizeState({
    ...state(),
    settings: { ...(state().settings as AppState['settings'] & { timezone?: string }), timezone: 'America/New_York' },
    availability: [{ weekday: 1, minutes: 9999, windows: [{ start: '18:00', end: '28:30' }] } as AppState['availability'][number]],
    fixedEvents: [
      { id: 'bad-event', title: '壊れた予定', weekday: 1, date: null, start: '25:00', end: '26:00' },
      { id: 'no-selector', title: '対象日のない予定', weekday: null, date: null, start: '18:00', end: '19:00' },
      { id: 'partial-range', title: '片側だけの期間', weekday: 1, date: null, startDate: ref, endDate: null, start: '18:00', end: '19:00' },
      { id: 'duplicate', title: '古い予定', weekday: 1, date: null, start: '18:00', end: '19:00' },
      { id: 'duplicate', title: '新しい予定', weekday: 2, date: null, start: '19:00', end: '20:00' },
    ],
    dayPlans: [
      { date: ref, load: 'light', memo: '古い', availabilityWindows: [{ start: '18:00', end: '28:30' }] },
      { date: '2026-02-30', load: 'normal', memo: '不正日', availabilityWindows: null },
      { date: ref, load: 'heavy', memo: '新しい', availabilityWindows: [{ start: '20:00', end: '21:00' }] },
    ],
  });
  check('旧タイムゾーン設定を現行設定へ残さない', !('timezone' in legacy.settings), legacy.settings);
  check('旧データの過大分数と24時超え時間帯を有効範囲へ補正', legacy.availability[0].minutes <= 359
    && legacy.availability[0].windows.every((window) => window.start < window.end && window.end <= '23:59'), legacy.availability);
  check('壊れた固定予定を通常計画へ残さず、重複IDは最新だけを保持', legacy.fixedEvents.length === 1
    && legacy.fixedEvents[0].id === 'duplicate'
    && legacy.fixedEvents[0].title === '新しい予定', legacy.fixedEvents);
  check('不正日の日別例外を除外し、重複日は最新の設定へ正規化', legacy.dayPlans.length === 1
    && legacy.dayPlans[0].date === ref
    && legacy.dayPlans[0].load === 'heavy'
    && legacy.dayPlans[0].memo === '新しい'
    && legacy.dayPlans[0].availabilityWindows?.[0]?.start === '20:00', legacy.dayPlans);
  const legacyGoalOverflow = normalizeState({
    ...state(),
    version: 5,
    schemaVersion: 5,
    goal: { id: 'legacy-goal', name: '夏期期間終了', examDate: addDays(ref, 20), createdAt: new Date().toISOString() },
    materials: [{ ...material, name: 'ハム数', targetDate: addDays(ref, 30) }],
  });
  check('旧データの教材期限を失わず単一目標日を延長して同期可能なv6へ移行', legacyGoalOverflow.version === 6
    && legacyGoalOverflow.schemaVersion === 6
    && legacyGoalOverflow.goal?.examDate === addDays(ref, 30)
    && legacyGoalOverflow.materials[0].targetDate === addDays(ref, 30), legacyGoalOverflow.goal);
}

console.log('--- 記録編集・削除の再構築 ---');
{
  const yesterday = addDays(ref, -1);
  const added = appReducer(state(), { type: 'RECORD_SESSION', input: { ...record(false, 2).input, date: yesterday, startTime: '08:30' } });
  const session = added.sessions.at(-1)!;
  check('昨日の手動記録を登録できる', session.date === yesterday && session.startedAt === localDateTimeToISOString(yesterday, '08:30'));
  const edited = appReducer(added, { type: 'UPDATE_SESSION', sessionId: session.id, input: { ...record(false, 4).input, date: yesterday, startTime: '09:00', minutes: 40 } });
  check('記録時間を編集すると集計も変わる', edited.sessions.find((entry) => entry.id === session.id)?.minutes === 40);
  check('記録時間編集後の分析集計も再計算される', computeAnalytics(edited, ref).weekMinutes === 40, computeAnalytics(edited, ref));
  check('完了量編集で範囲を基準から再構築する', JSON.stringify(edited.materials[0].completedRanges) === JSON.stringify([{ start: 10, end: 13 }]), edited.materials[0]);
  const editedAgain = appReducer(edited, { type: 'UPDATE_SESSION', sessionId: session.id, input: { ...record(false, 3).input, date: yesterday, startTime: '09:00', minutes: 30 } });
  check('同じ記録を複数回編集しても二重加算しない', JSON.stringify(editedAgain.materials[0].completedRanges) === JSON.stringify([{ start: 10, end: 12 }]), editedAgain.materials[0]);
  const deleted = appReducer(editedAgain, { type: 'DELETE_SESSION', sessionId: session.id });
  check('記録削除で教材進捗を基準値へ戻す', deleted.materials[0].doneAmount === 0 && deleted.sessions.length === 0, deleted.materials[0]);

  const completed = appReducer(state({ materials: [{ ...material, reviewEnabled: true }] }), record(true, 11));
  const completedSession = completed.sessions.at(-1)!;
  const afterDelete = appReducer(completed, { type: 'DELETE_SESSION', sessionId: completedSession.id });
  check('完了記録削除でタスク完了と生成復習を戻す', afterDelete.tasks.some((entry) => entry.materialId === material.id && entry.type === 'new' && entry.status === 'planned')
    && !(completedSession.generatedReviewTaskIds ?? []).some((id) => afterDelete.tasks.some((entry) => entry.id === id)), afterDelete.tasks);

  const legacySession = { ...session, id: 'legacy', progressRangesAdded: undefined, taskSnapshotBefore: undefined };
  const legacy = appReducer(state({ materials: [{ ...material, doneAmount: 5, completedRanges: [{ start: 1, end: 5 }] }], sessions: [legacySession], tasks: [] }), { type: 'DELETE_SESSION', sessionId: 'legacy' });
  check('旧形式セッション削除でも既存進捗を推測で消さない', legacy.materials[0].doneAmount === 5, legacy.materials[0]);
  const normalizedLegacy = normalizeState({ ...state(), version: 2, schemaVersion: 2, sessions: [legacySession] });
  check('旧形式セッションを正規化しても記録内容を失わない', normalizedLegacy.sessions[0].id === 'legacy' && normalizedLegacy.sessions[0].minutes === legacySession.minutes);
}

console.log('--- 数値入力・Undo ---');
{
  check('全選択から空欄にしても0ではなく編集中のnullになる', parseNumericDraft('', false) === null);
  check('小数入力途中の1.を文字列として保持する', sanitizeNumericDraft('1.', true) === '1.' && parseNumericDraft('1.', true) === 1);
  check('空欄と有効な0を区別する', parseNumericDraft('', false) === null && parseNumericDraft('0', false) === 0);
  const snapshot = state();
  const first = createUndoEntry(snapshot, '最初', 1_000);
  const replacement = createUndoEntry({ ...snapshot, isDemo: true }, '次', 2_000);
  check('新しい操作で古いUndoスナップショットを置き換えられる', replacement.label === '次' && replacement.state.isDemo && first.label === '最初');
  check('Undoは15秒以内だけ有効', isUndoEntryValid(first, 1_000 + UNDO_WINDOW_MS) && !isUndoEntryValid(first, 1_001 + UNDO_WINDOW_MS));
}

console.log('--- 設定セクションdraft ---');
{
  const base = emptyState().settings;
  const latest = { ...base, theme: 'dark' as const, maxDailyMinutes: 500 };
  const oldStudy = { ...studySettingsDraft(base), sessionMaxMinutes: 75 };
  const studySaved = mergeStudySettings(latest, oldStudy);
  check('学習設定だけ保存しても最新テーマを戻さない', studySaved.theme === 'dark' && studySaved.sessionMaxMinutes === 75);
  const latestStudy = { ...latest, maxDailyMinutes: 620 };
  const timerSaved = mergeTimerSettings(latestStudy, { ...base.timer, defaultMode: 'pomodoro' });
  check('タイマー設定保存で最新の学習設定を戻さない', timerSaved.maxDailyMinutes === 620 && timerSaved.timer.defaultMode === 'pomodoro');
  const clean = reconcileSectionDraft(oldStudy, studySettingsDraft(latestStudy), false);
  check('未編集draftは外部更新へ追従する', clean.draft.maxDailyMinutes === 620 && !clean.externalUpdate);
  const dirty = reconcileSectionDraft(oldStudy, studySettingsDraft(latestStudy), true);
  check('編集中draftは外部更新で消さず競合を通知する', dirty.draft.sessionMaxMinutes === 75 && dirty.externalUpdate);
}

console.log('--- 科目・アーカイブ・日別例外 ---');
{
  const targetSubject = { ...subject, id: 'target-subject', name: '統合先' };
  const subjectSession = { id: 'subject-session', taskId: 'task', subjectId: subject.id, materialId: material.id, date: ref, startedAt: new Date().toISOString(), minutes: 20, amountDone: 0, rangeLabel: '', focus: null, memo: '', source: 'manual' as const, taskSnapshotBefore: task() };
  const merged = appReducer(state({ subjects: [subject, targetSubject], sessions: [subjectSession] }), { type: 'MERGE_SUBJECT', sourceId: subject.id, targetId: targetSubject.id });
  check('科目統合後に古いsubjectIdが参照に残らない', !merged.subjects.some((entry) => entry.id === subject.id)
    && merged.materials.every((entry) => entry.subjectId === targetSubject.id)
    && merged.tasks.every((entry) => entry.subjectId === targetSubject.id)
    && merged.sessions.every((entry) => entry.subjectId === targetSubject.id && entry.taskSnapshotBefore?.subjectId !== subject.id), merged);
  const addedSubject = appReducer(state(), { type: 'ADD_SUBJECT', subject: targetSubject });
  const renamedSubject = appReducer(addedSubject, { type: 'UPDATE_SUBJECT', subject: { ...targetSubject, name: '物理', color: '#ff0000' } });
  check('科目の追加・名前変更・色変更を保存できる', renamedSubject.subjects.some((entry) => entry.id === targetSubject.id && entry.name === '物理' && entry.color === '#ff0000'));
  check('最後の1科目は削除できない', appReducer(state({ materials: [], tasks: [], sessions: [] }), { type: 'DELETE_SUBJECT', subjectId: subject.id }).subjects.length === 1);
  check('使用中科目の単純削除を防ぐ', appReducer(state({ subjects: [subject, targetSubject] }), { type: 'DELETE_SUBJECT', subjectId: subject.id }).subjects.length === 2);

  const archived = appReducer(state(), { type: 'UPDATE_MATERIAL', material: { ...material, archived: true } });
  check('教材アーカイブで未完了自動タスクを計画から外す', archived.materials[0].archived && !archived.tasks.some((entry) => entry.materialId === material.id && entry.status === 'planned'), archived.tasks);
  const restored = appReducer(archived, { type: 'UPDATE_MATERIAL', material: { ...archived.materials[0], archived: false } });
  check('教材復元で現在条件から計画を再生成する', !restored.materials[0].archived && restored.tasks.some((entry) => entry.materialId === material.id), restored.tasks);
  const retainedSession = { ...subjectSession, taskSnapshotBefore: undefined };
  const archivedWithRecord = appReducer(state({ sessions: [retainedSession] }), { type: 'UPDATE_MATERIAL', material: { ...material, archived: true } });
  check('教材をアーカイブしても学習記録は保持する', archivedWithRecord.sessions.some((entry) => entry.id === retainedSession.id));
  const deletedKeepingRecord = appReducer(state({ sessions: [retainedSession] }), { type: 'DELETE_MATERIAL', materialId: material.id });
  check('通常の教材削除は学習記録を保持する', deletedKeepingRecord.materials.length === 0 && deletedKeepingRecord.sessions.length === 1);
  const fullyDeleted = appReducer(state({ sessions: [retainedSession] }), { type: 'DELETE_MATERIAL', materialId: material.id, deleteSessions: true });
  check('完全削除は対象教材の学習記録も明示的に削除する', fullyDeleted.materials.length === 0 && fullyDeleted.sessions.length === 0);

  const plans = Array.from({ length: 7 }, (_, index) => ({ date: addDays(ref, index), load: 'light' as const, memo: String(index), availabilityWindows: null }));
  const withPlans = state({ dayPlans: plans });
  const without = appReducer(withPlans, { type: 'DELETE_DAY_PLAN', date: plans[5].date });
  check('6件以上の日別例外も個別削除できる', without.dayPlans.length === 6 && !without.dayPlans.some((plan) => plan.date === plans[5].date), without.dayPlans);
  const editedPlan = appReducer(withPlans, { type: 'UPDATE_DAY_PLAN', dayPlan: { ...plans[6], load: 'heavy', memo: '編集済み' } });
  check('既存の日別例外を同じ日付で編集できる', editedPlan.dayPlans.find((plan) => plan.date === plans[6].date)?.memo === '編集済み');

  const impossibleBase = state();
  const impossibleChanged = appReducer(impossibleBase, { type: 'TODAY_IMPOSSIBLE' });
  const impossibleUndo = appReducer(impossibleChanged, { type: 'REPLACE_STATE', state: impossibleBase });
  check('「今日は無理」のスナップショットUndoで元の配置へ戻る', impossibleUndo.tasks[0].scheduledDate === impossibleBase.tasks[0].scheduledDate);
  const archiveUndo = appReducer(archived, { type: 'REPLACE_STATE', state: state() });
  check('教材アーカイブのスナップショットUndoで使用中へ戻る', archiveUndo.materials[0].archived === false);

  const repaired = normalizeState({ ...state(), subjects: [], materials: [{ ...material, subjectId: 'missing' }] });
  const repairedIds = new Set(repaired.subjects.map((entry) => entry.id));
  check('normalizerは存在しないsubjectIdを残さない', repaired.materials.every((entry) => repairedIds.has(entry.subjectId)));
}

console.log('--- ログアウト時の保存タイマー ---');
{
  const values = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } as Storage;
  saveState(state());
  clearOwnedState();
  await new Promise((resolve) => setTimeout(resolve, 300));
  check('ログアウト後に保留中保存が端末データを復活させない', values.size === 0, [...values.keys()]);
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => { throw new DOMException('denied', 'SecurityError'); },
    clear: () => {},
    key: () => null,
    length: 0,
  } as Storage;
  let cleanupThrew = false;
  try { clearOwnedState(); } catch { cleanupThrew = true; }
  check('Storage APIが拒否されてもログアウト処理を例外で止めない', cleanupThrew === false);
}

console.log('--- 端末保存失敗の可視化 ---');
{
  let reported: string | null = null;
  const unsubscribe = subscribeStateSaveFailure((failure) => { reported = failure?.message ?? null; });
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  } as Storage;
  saveStateNow(state());
  check('端末保存容量超過を黙殺せず利用者向け状態へ通知', reported?.includes('端末保存容量') === true, reported);
  unsubscribe();
}

console.log(failures === 0 ? '\n🎉 ALL PASS (regressions)' : `\n💥 ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
