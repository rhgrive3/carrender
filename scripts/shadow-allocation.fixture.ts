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
const dayMinutes = new Map<string, number>();
for (const task of actual.tasks) {
  const minutes = Number(task.end!.slice(0, 2)) * 60 + Number(task.end!.slice(3))
    - Number(task.start!.slice(0, 2)) * 60 - Number(task.start!.slice(3));
  dayMinutes.set(task.date, (dayMinutes.get(task.date) ?? 0) + minutes);
}
const firstDay = dayMinutes.get('2026-07-10') ?? 0;
const maxDay = Math.max(0, ...dayMinutes.values());
if (actual.status !== 'success'
  || firstDay > 75
  || maxDay > 100
  || actual.objective.maxDailyMinutes !== maxDay
  || actual.objective.safetyBufferViolationMinutes !== 0) {
  console.error('通常配分の平準化fixtureが成立しません', JSON.stringify({ actual, firstDay, maxDay }));
  process.exit(1);
}
console.log('normal allocation balance fixture passed', { firstDay, maxDay, dayMinutes: Object.fromEntries(dayMinutes) });
