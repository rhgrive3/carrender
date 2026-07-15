import assert from 'node:assert/strict';
import { generatePlanV2 } from '../src/lib/schedulerRecovery';
import { emptyState } from '../src/state/AppContext';
import type { AppState, Material, SchedulerContext, StudyTask } from '../src/types';

const NOW = new Date('2026-07-15T00:00:00.000Z'); // JST 2026-07-15 09:00
const TODAY = '2026-07-15';
const subject = { id: 'subject-1', name: '数学', color: '#3366ff', importance: 3, weakness: 3 } as const;

function material(id: string, over: Partial<Material> = {}): Material {
  return {
    id,
    subjectId: subject.id,
    name: id,
    unit: '問題',
    totalAmount: 10,
    totalUnits: 10,
    doneAmount: 0,
    completedRanges: [],
    startDate: '2026-07-01',
    targetDate: '2026-07-10',
    priority: 3,
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
    createdAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

function reviewTask(id: string, materialId: string): StudyTask {
  return {
    id,
    subjectId: subject.id,
    materialId,
    title: `復習 ${id}`,
    rangeLabel: '1〜3',
    rangeStart: 1,
    rangeEnd: 3,
    materialRange: { start: 1, end: 3 },
    amount: 3,
    estimatedMinutes: 60,
    priority: 80,
    dueDate: '2026-07-10',
    type: 'review',
    status: 'planned',
    scheduledDate: '2026-07-10',
    scheduledStart: null,
    scheduledEnd: null,
    generatedBy: 'auto',
    memo: '',
    reviewStage: 0,
    createdAt: '2026-07-10T00:00:00.000Z',
    completedAt: null,
    sourceType: 'review',
    sourceId: id,
    placementStatus: 'unscheduled',
    placementLock: 'none',
  };
}

function flexibleTask(id: string): StudyTask {
  return {
    id,
    subjectId: subject.id,
    materialId: null,
    title: `手動 ${id}`,
    rangeLabel: '',
    rangeStart: null,
    rangeEnd: null,
    amount: 1,
    estimatedMinutes: 60,
    priority: 70,
    dueDate: null,
    type: 'new',
    status: 'planned',
    scheduledDate: '2026-07-10',
    scheduledStart: null,
    scheduledEnd: null,
    generatedBy: 'manual',
    memo: '',
    reviewStage: null,
    createdAt: '2026-07-10T00:00:00.000Z',
    completedAt: null,
    sourceType: 'manual',
    sourceId: id,
    placementStatus: 'unscheduled',
    placementLock: 'none',
    manualScheduling: {
      placementPolicy: 'flexibleBeforeDeadline',
      deadline: '2026-07-10',
      progressPolicy: { type: 'independent' },
      splittable: false,
    },
  };
}

function state(over: Partial<AppState> = {}): AppState {
  const base = emptyState();
  return {
    ...base,
    onboarded: true,
    goal: { id: 'goal-1', name: '試験', examDate: '2026-07-14', createdAt: '2026-07-01T00:00:00.000Z' },
    subjects: [subject],
    availability: ([0, 1, 2, 3, 4, 5, 6] as const).map((weekday) => ({
      weekday,
      minutes: 120,
      windows: [{ start: '10:00', end: '12:00' }],
    })),
    settings: {
      ...base.settings,
      maxDailyMinutes: 120,
      sessionMinMinutes: 5,
      sessionMaxMinutes: 90,
      taskGenerationHorizonDays: 7,
      reviewRule: { enabled: true, intervals: [1, 3, 7] },
    },
    ...over,
  };
}

function context(id: string): SchedulerContext {
  return {
    now: NOW,
    timezone: 'Asia/Tokyo',
    generationId: id,
    maxSearchNodes: 20_000,
    maxSearchMilliseconds: 5_000,
  };
}

{
  const overdue = material('overdue-material');
  const result = generatePlanV2(state({ materials: [overdue] }), context('expired-goal-material'));
  assert.notEqual(result.status, 'invalidInput', '試験日と教材期限が過ぎても回復計画を入力エラーにしない');
  assert.ok(
    result.scheduledTasks.some((task) => task.materialId === overdue.id && task.scheduledDate >= TODAY),
    '期限超過教材の未完了分を今日以降へ再配置する',
  );
  const report = result.deadlineReports.find((item) => item.workItemId === `material:${overdue.id}`);
  assert.ok(report && report.deadline === overdue.targetDate && report.overdueDays === 5, '元の期限と超過日数をレポートへ戻す');
  assert.ok((report?.scheduledMinutes ?? 0) > 0, '回復計画で配置した分数を0分扱いにしない');
}

{
  const doneMaterial = material('reviewed-material', {
    targetDate: '2026-07-30',
    doneAmount: 10,
    completedRanges: [{ start: 1, end: 10 }],
    reviewEnabled: true,
  });
  const reviews = [
    reviewTask('review-a', doneMaterial.id),
    reviewTask('review-b', doneMaterial.id),
    reviewTask('review-c', doneMaterial.id),
  ];
  const result = generatePlanV2(state({
    goal: { id: 'goal-2', name: '試験', examDate: '2026-07-30', createdAt: '2026-07-01T00:00:00.000Z' },
    materials: [doneMaterial],
    tasks: reviews,
  }), context('overdue-review-ramp'));
  const placed = result.scheduledTasks.filter((task) => reviews.some((review) => review.id === task.id));
  assert.equal(placed.length, 3, '期限切れ復習を未配置のまま捨てない');
  assert.equal(new Set(placed.map((task) => task.scheduledDate)).size, 3, '期限切れ復習を初日に集中させず日別容量へ分散する');
  assert.ok(placed.every((task) => task.scheduledDate >= TODAY), '期限切れ復習を過去日へ残さない');
  assert.ok(placed.every((task) => task.dueDate === '2026-07-10'), '表示用の元期限は保持する');
}

{
  const task = flexibleTask('manual-overdue');
  const result = generatePlanV2(state({ materials: [], tasks: [task] }), context('overdue-manual'));
  const placed = result.scheduledTasks.find((item) => item.id === task.id || item.sourceId === task.id);
  assert.ok(placed && placed.scheduledDate >= TODAY, '期限切れの柔軟手動タスクも今日以降へ回復する');
  assert.equal(placed?.manualScheduling?.deadline, '2026-07-10', '回復配置後も利用者が設定した元期限を保持する');
  assert.ok(result.warnings.some((warning) => warning.code === 'OVERDUE_RECOVERY' && warning.targetId === task.id));
}

console.log('✅ overdue scheduler recovery regressions passed');
