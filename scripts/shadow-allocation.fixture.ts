/** 通常配分ロジックをmainと修正ブランチで比較するための固定入力。 */
import { generatePlanV2 } from '../src/lib/schedulerV2';
import { emptyState } from '../src/state/AppContext';
import type { Material } from '../src/types';

const now = new Date('2026-07-09T23:00:00.000Z');
const base = emptyState();
const subject = { id: 'shadow-subject', name: '数学', color: '#4f7cff', importance: 4 as const, weakness: 3 as const };
const material = (id: string, priority: number, targetDate: string): Material => ({
  id,
  subjectId: subject.id,
  name: id,
  unit: '問題',
  totalAmount: 24,
  totalUnits: 24,
  doneAmount: 0,
  completedRanges: [],
  startDate: '2026-07-10',
  targetDate,
  priority,
  difficulty: 3,
  minutesPerUnit: 10,
  unitStep: 1,
  splittable: true,
  preferredCadence: { type: 'auto' },
  dailyTarget: null,
  weeklyTarget: null,
  deadlinePolicy: 'normal',
  examRelevance: 3,
  reviewEnabled: false,
  reviewIntervals: [1, 3, 7],
  paused: false,
  round: 1,
  archived: false,
  createdAt: now.toISOString(),
});
const state = {
  ...base,
  onboarded: true,
  subjects: [subject],
  materials: [material('shadow-a', 5, '2026-07-20'), material('shadow-b', 2, '2026-07-24')],
  availability: ([0, 1, 2, 3, 4, 5, 6] as const).map((weekday) => ({
    weekday,
    minutes: 180,
    windows: [{ start: '09:00', end: '12:00' }],
  })),
  settings: { ...base.settings, maxDailyMinutes: 180, sessionMinMinutes: 25, sessionMaxMinutes: 60, taskGenerationHorizonDays: 7 },
};
const result = generatePlanV2(state, {
  now,
  timezone: 'Asia/Tokyo',
  generationId: 'shadow-normal-allocation',
  maxSearchMilliseconds: 60_000,
});

const actual = {
  status: result.status,
  tasks: result.scheduledTasks.map((task) => ({
    materialId: task.materialId,
    date: task.scheduledDate,
    start: task.scheduledStart,
    end: task.scheduledEnd,
    range: task.materialRange,
    amount: task.amount,
  })),
  objective: result.objectiveReport,
  deficits: result.progressDeficits,
};
const expectedTasks = [
  ['shadow-a', '2026-07-10', '09:00', '09:30', 1, 3, 3],
  ['shadow-b', '2026-07-10', '09:30', '10:30', 13, 18, 6],
  ['shadow-a', '2026-07-10', '10:30', '11:30', 16, 21, 6],
  ['shadow-b', '2026-07-10', '11:30', '12:00', 19, 21, 3],
  ['shadow-b', '2026-07-11', '09:00', '09:40', 1, 4, 4],
  ['shadow-a', '2026-07-11', '09:40', '10:10', 22, 24, 3],
  ['shadow-b', '2026-07-11', '10:10', '10:40', 22, 24, 3],
  ['shadow-a', '2026-07-12', '09:00', '09:50', 4, 8, 5],
  ['shadow-b', '2026-07-13', '09:00', '09:40', 5, 8, 4],
  ['shadow-a', '2026-07-14', '09:00', '09:40', 9, 12, 4],
  ['shadow-b', '2026-07-15', '09:00', '09:40', 9, 12, 4],
  ['shadow-a', '2026-07-15', '09:40', '10:10', 13, 15, 3],
];
const actualTasks = actual.tasks.map((task) => [
  task.materialId, task.date, task.start, task.end, task.range?.start, task.range?.end, task.amount,
]);
if (actual.status !== 'success'
  || JSON.stringify(actualTasks) !== JSON.stringify(expectedTasks)
  || actual.objective.taskSwitches !== 6
  || actual.deficits.length !== 0) {
  console.error('通常配分のshadow fixtureがmain基準から変化しました', JSON.stringify(actual));
  process.exit(1);
}
console.log('normal allocation shadow fixture passed');
