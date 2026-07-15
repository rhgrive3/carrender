import assert from 'node:assert/strict';
import { legacyProgressBaselineRanges, plannedMaterialAmountThrough } from '../src/lib/taskFilters';
import type { Material, StudySession, StudyTask } from '../src/types';

const material: Material = {
  id: 'mat_chart',
  subjectId: 'subj',
  name: '達成率テスト教材',
  unit: '問題',
  totalAmount: 10,
  totalUnits: 10,
  doneAmount: 4,
  completedRanges: [{ start: 1, end: 4 }],
  startDate: '2026-07-08',
  targetDate: '2026-07-20',
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
  createdAt: '2026-07-08T00:00:00.000Z',
};

const manualSession: StudySession = {
  id: 'sess_manual',
  taskId: null,
  subjectId: 'subj',
  materialId: material.id,
  date: '2026-07-10',
  startedAt: '2026-07-10T09:00:00.000Z',
  minutes: 120,
  amountDone: 4,
  rangeLabel: 'フリー学習',
  focus: null,
  memo: '',
  source: 'manual',
  progressRangesAdded: [{ start: 1, end: 4 }],
};

function plannedTask(id: string, date: string, start: number, end: number): StudyTask {
  return {
    id,
    subjectId: 'subj',
    materialId: material.id,
    title: material.name,
    rangeLabel: `${start}〜${end}`,
    rangeStart: start,
    rangeEnd: end,
    amount: end - start + 1,
    estimatedMinutes: (end - start + 1) * 30,
    priority: 50,
    dueDate: material.targetDate,
    type: 'new',
    status: 'planned',
    scheduledDate: date,
    scheduledStart: '09:00',
    scheduledEnd: '10:30',
    generatedBy: 'auto',
    memo: '',
    reviewStage: null,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    completedAt: null,
    sourceType: 'material',
    sourceId: material.id,
    placementStatus: 'scheduled',
    placementLock: 'none',
    materialRange: { start, end },
  };
}

const tasks = [
  plannedTask('task_5_7', '2026-07-12', 5, 7),
  plannedTask('task_8_10', '2026-07-20', 8, 10),
];
const sessions = [manualSession];
const baseline = legacyProgressBaselineRanges(material, sessions);

assert.deepEqual(baseline, [], '日付が分かる新形式実績は旧基準進捗から除外される');

const oldBrokenEndpoint = plannedMaterialAmountThrough(
  tasks,
  material.id,
  material.totalAmount,
  material.targetDate,
  baseline,
  [],
);
assert.equal(oldBrokenEndpoint, 6, '実績範囲を渡さない旧計算では60%で止まる再現になる');

const actualThroughStart = sessions
  .filter((session) => session.materialId === material.id && session.date <= '2026-07-10')
  .flatMap((session) => session.progressRangesAdded ?? []);
const targetAtStart = plannedMaterialAmountThrough(
  tasks,
  material.id,
  material.totalAmount,
  '2026-07-10',
  baseline,
  [],
  actualThroughStart,
);
assert.equal(targetAtStart, 4, '手入力・フリー学習の実績を当日の目標線へ戻す');

const actualThroughMiddle = sessions
  .filter((session) => session.materialId === material.id && session.date <= '2026-07-12')
  .flatMap((session) => session.progressRangesAdded ?? []);
const targetAtMiddle = plannedMaterialAmountThrough(
  tasks,
  material.id,
  material.totalAmount,
  '2026-07-12',
  baseline,
  [],
  actualThroughMiddle,
);
assert.equal(targetAtMiddle, 7, '実績1〜4と予定5〜7を和集合で70%にする');

const actualThroughDeadline = sessions
  .filter((session) => session.materialId === material.id && session.date <= material.targetDate)
  .flatMap((session) => session.progressRangesAdded ?? []);
const targetAtDeadline = plannedMaterialAmountThrough(
  tasks,
  material.id,
  material.totalAmount,
  material.targetDate,
  baseline,
  [],
  actualThroughDeadline,
);
assert.equal(targetAtDeadline, 10, '実績済み範囲と残り予定を合わせ、期限日に100%へ到達する');

const overlappingActual = [...actualThroughDeadline, { start: 5, end: 5 }];
const noDoubleCount = plannedMaterialAmountThrough(
  tasks,
  material.id,
  material.totalAmount,
  material.targetDate,
  baseline,
  [],
  overlappingActual,
);
assert.equal(noDoubleCount, 10, '実績と予定が重複しても100%を超えて水増ししない');

console.log('✅ progress chart target regressions passed');
