import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  smoothMaterialSchedule,
  summarizeMaterialConcentration,
} from '../src/lib/materialScheduleSmoothing';
import {
  isMaterialConcentrationRegressionAcceptable,
  smoothMaterialScheduleSafely,
} from '../src/lib/safeMaterialScheduleSmoothing';
import { emptyState } from '../src/state/AppContext';
import type {
  AppState,
  Material,
  ObjectiveReport,
  ScheduleGenerationResult,
  SchedulerContext,
  StudyTask,
} from '../src/types';

const D1 = '2026-07-15';
const D2 = '2026-07-16';
const D3 = '2026-07-17';
const D4 = '2026-07-18';
const D5 = '2026-07-19';
const D7 = '2026-07-21';
const generatedAt = '2026-07-14T23:00:00.000Z';
const context: SchedulerContext = {
  now: new Date(generatedAt), // JST 08:00。今日の全時間帯が候補になる。
  timezone: 'Asia/Tokyo',
  generationId: 'material-smoothing-regression',
  maxSearchMilliseconds: 60_000,
};

function material(over: Partial<Material> = {}): Material {
  return {
    id: 'mat-composition',
    subjectId: 'subject-english',
    name: '8セクション英作文',
    unit: 'セクション',
    totalAmount: 8,
    totalUnits: 8,
    doneAmount: 2,
    completedRanges: [{ start: 1, end: 2 }],
    startDate: D1,
    targetDate: D7,
    priority: 3,
    difficulty: 3,
    minutesPerUnit: 45,
    unitStep: 1,
    minimumChunkUnits: 1,
    maximumChunkUnits: 2,
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
    createdAt: generatedAt,
    ...over,
  };
}

function task(id: string, start: number, end: number, date: string, timeStart: string, timeEnd: string): StudyTask {
  return {
    id,
    subjectId: 'subject-english',
    materialId: 'mat-composition',
    title: '8セクション英作文',
    rangeLabel: `${start}〜${end}`,
    rangeStart: start,
    rangeEnd: end,
    materialRange: { start, end },
    amount: end - start + 1,
    estimatedMinutes: (end - start + 1) * 45,
    priority: 95,
    dueDate: D7,
    type: 'new',
    status: 'planned',
    scheduledDate: date,
    scheduledStart: timeStart,
    scheduledEnd: timeEnd,
    generatedBy: 'auto',
    reviewStage: null,
    createdAt: generatedAt,
    updatedAt: generatedAt,
    completedAt: null,
    sourceType: 'material',
    sourceId: 'mat-composition',
    placementStatus: 'scheduled',
    placementLock: 'none',
  };
}

function objective(): ObjectiveReport {
  return {
    strictDeadlineViolations: 0,
    lockViolations: 0,
    unscheduledStrictMinutes: 0,
    progressDebtMinutes: 0,
    normalOverdueMinutes: 0,
    unscheduledMinutes: 0,
    subjectImbalance: 0,
    timePreferenceViolations: 0,
    taskSwitches: 0,
    sameMaterialStreak: 1,
    maxDailyMinutes: 180,
    dailyLoadVariance: 1_350,
    adjacentDayDifference: 270,
    consecutiveHeavyDays: 0,
    subjectConcentration: 270,
    materialConcentration: 270,
    cadenceViolations: 0,
    dailyTargetDeviation: 0,
    weeklyTargetDeviation: 0,
    safetyBufferViolationMinutes: 0,
  };
}

const sourceTasks = [
  task('composition-3-4', 3, 4, D4, '09:00', '10:30'),
  task('composition-5-6', 5, 6, D4, '13:00', '14:30'),
  task('composition-7-8', 7, 8, D5, '09:00', '10:30'),
];
const base = emptyState();
const state: AppState = {
  ...base,
  onboarded: true,
  goal: { id: 'goal', name: '試験', examDate: D7, createdAt: generatedAt },
  subjects: [{ id: 'subject-english', name: '英語', color: '#4f7cff', importance: 3, weakness: 3 }],
  materials: [material()],
  tasks: [],
  availability: ([0, 1, 2, 3, 4, 5, 6] as const).map((weekday) => ({
    weekday,
    minutes: 420,
    windows: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
  })),
  settings: {
    ...base.settings,
    maxDailyMinutes: 420,
    sessionMinMinutes: 30,
    sessionMaxMinutes: 90,
    taskGenerationHorizonDays: 7,
  },
};
const result: ScheduleGenerationResult = {
  status: 'success',
  scheduledTasks: sourceTasks,
  unscheduledWork: [],
  conflicts: [],
  warnings: [],
  progressDeficits: [],
  capacityReport: {
    horizonStart: D1,
    horizonEnd: D7,
    requiredMinutes: 270,
    availableMinutes: 2_940,
    shortages: [],
  },
  deadlineReports: [{
    workItemId: 'material:mat-composition',
    policy: 'strict',
    deadline: D7,
    feasible: true,
    scheduledMinutes: 270,
    requiredMinutes: 270,
    shortageMinutes: 0,
    overdueDays: 0,
  }],
  objectiveReport: objective(),
  validationErrors: [],
  generatedAt,
  generationId: context.generationId,
};

const before = summarizeMaterialConcentration(result.scheduledTasks, 'mat-composition');
const smoothed = smoothMaterialSchedule(state, result, context);
const after = summarizeMaterialConcentration(smoothed.scheduledTasks, 'mat-composition');
assert.deepEqual(before, { activeDays: 2, sameDayExcess: 1, maxDayMinutes: 180 }, '再現ケースは2日集中・同日2チャンク');
assert.equal(after.activeDays, 3, '3セッションを3日に分散する');
assert.equal(after.sameDayExcess, 0, '同日複数チャンクを解消する');
assert.equal(after.maxDayMinutes, 90, '1日の最大進捗を180分から90分へ半減する');

const originalDate = new Map(result.scheduledTasks.map((entry) => [entry.id, entry.scheduledDate] as const));
for (const entry of smoothed.scheduledTasks) {
  assert.ok(entry.scheduledDate <= originalDate.get(entry.id)!, `strictタスク${entry.id}を元の実行可能日より後ろへ動かさない`);
  assert.ok(entry.scheduledDate <= D7, `strictタスク${entry.id}を期限内に保つ`);
}
assert.deepEqual(
  smoothed.scheduledTasks.map((entry) => ({ id: entry.id, range: entry.materialRange, amount: entry.amount, minutes: entry.estimatedMinutes })),
  result.scheduledTasks.map((entry) => ({ id: entry.id, range: entry.materialRange, amount: entry.amount, minutes: entry.estimatedMinutes })),
  'チャンクのID・範囲・単位数・見積時間を変更しない',
);
assert.equal(smoothed.deadlineReports[0].feasible, true, '期限保証レポートを維持する');
assert.equal(smoothed.objectiveReport.safetyBufferViolationMinutes, 0, '安全完了日違反を増やさない');
assert.ok(smoothed.objectiveReport.maxDailyMinutes <= result.objectiveReport.maxDailyMinutes + 15, '日別最大負荷の増加を15分以内に抑える');

const rerun = smoothMaterialSchedule(state, smoothed, context);
assert.deepEqual(rerun.scheduledTasks, smoothed.scheduledTasks, '同じ入力へ再適用しても予定を揺らさない');

// 実バックアップの試作比較で見つかった数学XSの隠れ回帰を、その数値で固定する。
assert.equal(isMaterialConcentrationRegressionAcceptable(
  { activeDays: 36, sameDayExcess: 0, maxDayMinutes: 75 },
  { activeDays: 34, sameDayExcess: 2, maxDayMinutes: 125 },
), false, '数学XSの75→125分・実施日36→34・同日重複0→2を拒否する');
assert.equal(isMaterialConcentrationRegressionAcceptable(
  { activeDays: 10, sameDayExcess: 1, maxDayMinutes: 90 },
  { activeDays: 9, sameDayExcess: 2, maxDayMinutes: 105 },
), true, '小さな詰合せ誤差は許容する');

function guardTask(
  materialId: string,
  id: string,
  rangeStart: number,
  rangeEnd: number,
  date: string,
  minutes: number,
): StudyTask {
  return {
    ...task(id, rangeStart, rangeEnd, date, '09:00', minutes === 90 ? '10:30' : '09:45'),
    materialId,
    sourceId: materialId,
    title: materialId,
    estimatedMinutes: minutes,
  };
}

const guardTarget = material({
  id: 'guard-target',
  name: '集中改善対象',
  deadlinePolicy: 'normal',
  doneAmount: 0,
  completedRanges: [],
});
const guardVictim = material({
  id: 'guard-victim',
  name: '交換で悪化し得る教材',
  deadlinePolicy: 'normal',
  doneAmount: 0,
  completedRanges: [],
});
const guardTasks = [
  guardTask('guard-target', 'target-a', 1, 2, D4, 90),
  guardTask('guard-target', 'target-b', 3, 4, D4, 90),
  guardTask('guard-target', 'target-c', 5, 6, D5, 90),
  guardTask('guard-victim', 'victim-a', 1, 1, D1, 45),
  guardTask('guard-victim', 'victim-b', 2, 2, D2, 45),
  guardTask('guard-victim', 'victim-c', 3, 3, D3, 45),
];
const guardState: AppState = {
  ...state,
  materials: [guardTarget, guardVictim],
};
const guardResult: ScheduleGenerationResult = {
  ...result,
  scheduledTasks: guardTasks,
  deadlineReports: [],
};
let smootherCalls = 0;
let victimWasFrozen = false;
const guarded = smoothMaterialScheduleSafely(guardState, guardResult, context, (_nextState, working) => {
  smootherCalls += 1;
  const frozen = working.scheduledTasks
    .filter((entry) => entry.materialId === 'guard-victim')
    .every((entry) => entry.placementLock === 'date');
  if (smootherCalls === 2) victimWasFrozen = frozen;
  return {
    ...working,
    scheduledTasks: working.scheduledTasks.map((entry) => {
      if (entry.id === 'target-a') return { ...entry, scheduledDate: D2 };
      if (entry.id === 'victim-b' && !frozen) return { ...entry, scheduledDate: D1 };
      return entry;
    }),
  };
});

assert.equal(smootherCalls, 2, '悪化教材を検知したら凍結して一度再探索する');
assert.equal(victimWasFrozen, true, '再探索では悪化した教材を元日付へ固定する');
assert.deepEqual(
  summarizeMaterialConcentration(guarded.scheduledTasks, 'guard-target'),
  { activeDays: 3, sameDayExcess: 0, maxDayMinutes: 90 },
  '対象教材の集中改善は維持する',
);
assert.deepEqual(
  summarizeMaterialConcentration(guarded.scheduledTasks, 'guard-victim'),
  { activeDays: 3, sameDayExcess: 0, maxDayMinutes: 45 },
  '交換相手の集中悪化は元状態へ戻す',
);
assert.ok(guarded.scheduledTasks.every((entry) => entry.placementLock === 'none'), '一時的な凍結ロックを出力へ残さない');

const recoverySource = readFileSync(new URL('../src/lib/schedulerRecovery.ts', import.meta.url), 'utf8');
assert.match(recoverySource, /smoothMaterialScheduleSafely\(state, generateBasePlanV2\(state, context\), context\)/, '通常生成経路へ安全な平準化を組み込む');
assert.match(recoverySource, /smoothMaterialScheduleSafely\([\s\S]*adjustedState,[\s\S]*generateBasePlanV2\(adjustedState, context\)/, '期限超過回復経路にも安全な平準化を組み込む');

console.log('✅ material schedule smoothing regressions passed');
