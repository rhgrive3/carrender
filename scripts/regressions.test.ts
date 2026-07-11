/** 配置コアの外側で起きた重大回帰のテスト。 */
/// <reference types="node" />
import { addDays, today } from '../src/lib/date';
import { computeAnalytics } from '../src/lib/analytics';
import { computeCapacity, generatePlan, subjectAchievementMap } from '../src/lib/scheduler';
import { clearOwnedState, saveState } from '../src/lib/storage';
import { isPlacedPlanTask, plannedMaterialAmountThrough } from '../src/lib/taskFilters';
import { adjustCompletedRanges, appReducer, emptyState } from '../src/state/AppContext';
import type { AppState, Material, StudyTask } from '../src/types';

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
}

console.log('--- 教材進捗編集・固定状態 ---');
{
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
  const duplicate = task({ id: 'duplicate', scheduledDate: visible.scheduledDate });
  check('目標グラフ用の教材範囲は重複タスクを和集合で数える', plannedMaterialAmountThrough([visible, duplicate, hidden], material.id, material.totalAmount, ref) === 11);
  check('旧データの初期進捗と完了タスク範囲を二重計上しない', plannedMaterialAmountThrough(
    [task({ id: 'old-done', status: 'done', rangeStart: 1, rangeEnd: 20, materialRange: { start: 1, end: 20 }, amount: 20 })],
    material.id,
    material.totalAmount,
    ref,
    [{ start: 1, end: 20 }],
  ) === 20);
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

  const conflict = task({ placementLock: 'time', scheduledStart: '01:00', scheduledEnd: '02:50' });
  const conflictedPlan = generatePlan(state({ tasks: [conflict] }), ref, 'capacity conflict', { now: new Date(`${ref}T12:00:00+09:00`) });
  check('固定衝突がある計画は旧capacity.okをtrueにしない', conflictedPlan.result.capacity.ok === false, conflictedPlan.result.capacity);
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
}

console.log(failures === 0 ? '\n🎉 ALL PASS (regressions)' : `\n💥 ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
