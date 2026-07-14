import assert from 'node:assert/strict';
import { buildProgressChartDates, stablePlanTasks } from '../src/lib/progressChart';
import { generatePlanV2 } from '../src/lib/schedulerRecovery';
import { emptyState } from '../src/state/AppContext';
import type { AppState, DeadlinePolicy, Material, StudySession, StudyTask } from '../src/types';

const NOW = new Date('2026-07-14T00:00:00.000Z'); // JST 2026-07-14 09:00
const TODAY = '2026-07-14';
const subject = { id: 'subject', name: '数学', color: '#3366ff', importance: 3, weakness: 3 } as const;

function material(id: string, deadlinePolicy: DeadlinePolicy): Material {
  return {
    id,
    subjectId: subject.id,
    name: id,
    unit: '問題',
    totalAmount: 4,
    totalUnits: 4,
    doneAmount: 0,
    completedRanges: [],
    startDate: '2026-07-01',
    targetDate: '2026-07-10',
    priority: 3,
    difficulty: 3,
    minutesPerUnit: 30,
    unitStep: 1,
    splittable: true,
    preferredCadence: { type: 'auto' },
    dailyTarget: null,
    weeklyTarget: null,
    deadlinePolicy,
    examRelevance: 3,
    reviewEnabled: false,
    reviewIntervals: [1, 3, 7],
    paused: false,
    round: 1,
    archived: false,
    createdAt: NOW.toISOString(),
  };
}

function stateWith(item: Material): AppState {
  const base = emptyState();
  return {
    ...base,
    onboarded: true,
    subjects: [subject],
    materials: [item],
    availability: ([0, 1, 2, 3, 4, 5, 6] as const).map((weekday) => ({
      weekday,
      minutes: 480,
      windows: [{ start: '09:00', end: '17:00' }],
    })),
    settings: {
      ...base.settings,
      maxDailyMinutes: 480,
      sessionMinMinutes: 5,
      sessionMaxMinutes: 90,
      taskGenerationHorizonDays: 7,
    },
  };
}

for (const policy of ['strict', 'normal'] as const) {
  const result = generatePlanV2(stateWith(material(`overdue-${policy}`, policy)), {
    now: NOW,
    timezone: 'Asia/Tokyo',
    generationId: `overdue-${policy}`,
    maxSearchMilliseconds: 60_000,
  });
  assert.ok(result.scheduledTasks.length > 0, `${policy}の期限超過教材にも予定を生成する`);
  assert.ok(result.scheduledTasks.every((task) => task.scheduledDate >= TODAY), `${policy}の回復予定は今日以降に置く`);
  assert.ok(result.warnings.some((warning) => warning.code === 'OVERDUE_RECOVERY'), `${policy}の期限超過を明示する`);
  assert.ok(result.scheduledTasks.every((task) => task.dueDate === '2026-07-10'), `${policy}の元期限を表示用データへ保持する`);
}

const originalTask: StudyTask = {
  id: 'completed-task',
  subjectId: subject.id,
  materialId: 'material',
  title: '当初の計画',
  rangeLabel: '1〜2',
  rangeStart: 1,
  rangeEnd: 2,
  materialRange: { start: 1, end: 2 },
  amount: 2,
  estimatedMinutes: 60,
  priority: 50,
  dueDate: '2026-07-14',
  type: 'new',
  status: 'planned',
  scheduledDate: '2026-07-14',
  scheduledStart: '09:00',
  scheduledEnd: '10:00',
  generatedBy: 'auto',
  reviewStage: null,
  createdAt: NOW.toISOString(),
  completedAt: null,
};
const recalculatedTask: StudyTask = {
  ...originalTask,
  title: '再計算後の表示',
  estimatedMinutes: 30,
  scheduledDate: '2026-07-16',
  status: 'done',
  completedAt: NOW.toISOString(),
};
const completedSession: StudySession = {
  id: 'session',
  taskId: originalTask.id,
  subjectId: subject.id,
  materialId: 'material',
  date: '2026-07-14',
  startedAt: NOW.toISOString(),
  minutes: 55,
  amountDone: 2,
  rangeLabel: '1〜2',
  focus: 4,
  memo: '',
  source: 'timer',
  completedTask: true,
  taskSnapshotBefore: originalTask,
};
const stable = stablePlanTasks([recalculatedTask], [completedSession]);
assert.equal(stable.length, 1);
assert.equal(stable[0].scheduledDate, originalTask.scheduledDate, '完了済みタスクの当初予定日を分析へ固定する');
assert.equal(stable[0].estimatedMinutes, originalTask.estimatedMinutes, '完了済みタスクの当初予定時間を分析へ固定する');

const chartMaterial = material('chart', 'normal');
chartMaterial.startDate = '2026-01-01';
chartMaterial.targetDate = '2026-12-31';
const dates = buildProgressChartDates([chartMaterial], '2026-07-14', [], ['2026-07-13']);
assert.equal(dates.length, 365, '1年以内の達成率推移は日単位で描画する');
assert.ok(dates.includes('2026-07-13'), '実績日は必ず描画点へ含める');

console.log('✅ user-request regressions passed');
