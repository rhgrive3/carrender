import type {
  AppState,
  ISODate,
  Material,
  ScheduleGenerationResult,
  SchedulerContext,
  StudyTask,
} from '../types';
import { addDays, diffDays, hmToMinutes, weekdayOf } from './date';
import {
  dateInTimeZone,
  generatePlanV2 as generateBasePlanV2,
  mergeMinuteRanges,
  subtractMinuteRanges,
} from './schedulerV2';

function recoveryEnd(state: AppState, today: ISODate): ISODate {
  const configuredEnd = addDays(today, Math.max(1, state.settings.taskGenerationHorizonDays ?? 42) - 1);
  // 目標日がまだ先なら、回復計画もその日を越えない。目標日自体が過ぎている
  // 場合だけローリング期間を新しい回復窓として使う。
  return state.goal?.examDate && state.goal.examDate >= today ? state.goal.examDate : configuredEnd;
}

function taskDeadline(task: StudyTask): ISODate | null {
  if (task.manualScheduling?.placementPolicy === 'flexibleBeforeDeadline' && task.manualScheduling.deadline) {
    return task.manualScheduling.deadline;
  }
  if (task.type === 'review' && task.dueDate) return task.dueDate;
  if ((task.generatedBy === 'manual' || task.sourceType === 'manual') && task.dueDate) return task.dueDate;
  return null;
}

function isMovableOverdueTask(task: StudyTask, today: ISODate): boolean {
  if (task.status !== 'planned') return false;
  if (task.placementLock === 'date' || task.placementLock === 'time') return false;
  const policy = task.manualScheduling?.placementPolicy;
  if (policy === 'fixedDateFlexibleTime' || policy === 'fixedTime') return false;
  const deadline = taskDeadline(task);
  return Boolean(deadline && deadline < today);
}

function fixedEventsOn(state: AppState, date: ISODate) {
  const weekday = weekdayOf(date);
  return state.fixedEvents.filter((event) => {
    if (event.date) return event.date === date;
    if (event.weekday !== null && event.weekday !== weekday) return false;
    if (event.startDate && date < event.startDate) return false;
    if (event.endDate && date > event.endDate) return false;
    return event.weekday !== null || Boolean(event.startDate || event.endDate);
  });
}

/** 回復対象を分散するための、固定予定控除後のおおよその日別容量。 */
function recoveryCapacityOn(state: AppState, date: ISODate): number {
  const override = state.dayPlans.find((plan) => plan.date === date);
  if (override?.load === 'rest') return 0;
  const availability = state.availability.find((slot) => slot.weekday === weekdayOf(date));
  const windows = override?.availabilityWindows ?? availability?.windows ?? [];
  const windowRanges = mergeMinuteRanges(windows.map((window) => ({
    start: hmToMinutes(window.start),
    end: hmToMinutes(window.end),
  })));
  const eventRanges = mergeMinuteRanges(fixedEventsOn(state, date).map((event) => ({
    start: hmToMinutes(event.start),
    end: hmToMinutes(event.end),
  })));
  const free = subtractMinuteRanges(windowRanges, eventRanges);
  const availableMinutes = free.reduce((sum, range) => sum + range.end - range.start, 0);
  const configuredMinutes = override?.availabilityWindows
    ? availableMinutes
    : availability?.minutes ?? availableMinutes;
  const factor = override?.load === 'light' ? 0.6 : override?.load === 'heavy' ? 1.2 : 1;
  return Math.max(0, Math.min(
    availableMinutes,
    Math.round(configuredMinutes * factor),
    state.settings.maxDailyMinutes,
  ));
}

/**
 * 期限切れ復習を全部今日へ積まず、現在の予定負荷と日別容量を見て回復開始日をずらす。
 * 実配置は既存ソルバーが行うため、容量不足なら後続日へ送られる。
 */
function spreadOverdueReviewReleases(
  state: AppState,
  tasks: StudyTask[],
  today: ISODate,
  end: ISODate,
): Map<string, ISODate> {
  const days: { date: ISODate; capacity: number }[] = [];
  for (let date = today; date <= end; date = addDays(date, 1)) {
    const capacity = recoveryCapacityOn(state, date);
    if (capacity > 0) days.push({ date, capacity });
  }
  if (days.length === 0) return new Map();

  const overdueIds = new Set(tasks.map((task) => task.id));
  const load = new Map(days.map(({ date }) => [date, 0]));
  for (const task of state.tasks) {
    if (task.status !== 'planned' || overdueIds.has(task.id)) continue;
    if (!load.has(task.scheduledDate)) continue;
    load.set(task.scheduledDate, (load.get(task.scheduledDate) ?? 0) + task.estimatedMinutes);
  }

  const releases = new Map<string, ISODate>();
  const reviews = tasks
    .filter((task) => task.type === 'review')
    .sort((a, b) => (taskDeadline(a) ?? '').localeCompare(taskDeadline(b) ?? '') || a.id.localeCompare(b.id));
  for (const task of reviews) {
    const minutes = Math.max(1, task.estimatedMinutes);
    const chosen = [...days].sort((a, b) => {
      const aProjected = ((load.get(a.date) ?? 0) + minutes) / Math.max(1, a.capacity);
      const bProjected = ((load.get(b.date) ?? 0) + minutes) / Math.max(1, b.capacity);
      return aProjected - bProjected
        || (load.get(a.date) ?? 0) - (load.get(b.date) ?? 0)
        || a.date.localeCompare(b.date);
    })[0];
    releases.set(task.id, chosen.date);
    load.set(chosen.date, (load.get(chosen.date) ?? 0) + minutes);
  }
  return releases;
}

function originalTaskForOutput(overdueTasks: Map<string, StudyTask>, task: StudyTask): StudyTask | undefined {
  return overdueTasks.get(task.id)
    ?? (task.sourceId ? overdueTasks.get(task.sourceId) : undefined)
    ?? [...overdueTasks.values()].find((original) => original.sourceId === task.sourceId);
}

function restoreTaskDeadline(task: StudyTask, original: StudyTask): StudyTask {
  const manualScheduling = original.manualScheduling
    ? {
        ...(task.manualScheduling ?? original.manualScheduling),
        placementPolicy: original.manualScheduling.placementPolicy,
        fixedDate: original.manualScheduling.fixedDate,
        fixedStartTime: original.manualScheduling.fixedStartTime,
        deadline: original.manualScheduling.deadline,
      }
    : task.manualScheduling;
  return {
    ...task,
    dueDate: original.dueDate,
    manualScheduling,
  };
}

/**
 * 期限切れを「候補日なし」として捨てず、ローリング計画期間へ回収してから
 * 既存ソルバーへ渡す。元の期限は結果へ戻し、期限違反と回復予定を同時に示す。
 */
export function generatePlanV2(state: AppState, context: SchedulerContext): ScheduleGenerationResult {
  const today = dateInTimeZone(context.now, context.timezone);
  const end = recoveryEnd(state, today);
  const overdueMaterials = new Map<string, Material>();
  for (const material of state.materials) {
    if (!material.paused && !material.archived && material.doneAmount < material.totalAmount && material.targetDate < today) {
      overdueMaterials.set(material.id, material);
    }
  }
  const overdueTasks = new Map<string, StudyTask>();
  for (const task of state.tasks) {
    if (isMovableOverdueTask(task, today)) overdueTasks.set(task.id, task);
  }
  if (overdueMaterials.size === 0 && overdueTasks.size === 0) return generateBasePlanV2(state, context);

  const reviewReleases = spreadOverdueReviewReleases(state, [...overdueTasks.values()], today, end);
  const adjustedState: AppState = {
    ...state,
    // 目標日が既に過ぎている時だけ、内部計算用の目標日も回復窓まで延ばす。
    // これをしないと仮期限が試験日より後という検証エラーで計画全体が止まる。
    goal: state.goal && state.goal.examDate < end ? { ...state.goal, examDate: end } : state.goal,
    materials: state.materials.map((material) => {
      const original = overdueMaterials.get(material.id);
      if (!original) return material;
      return {
        ...material,
        targetDate: end,
        preferredFinishDate: undefined,
        deadlinePolicy: original.deadlinePolicy === 'strict' ? 'normal' : original.deadlinePolicy,
      };
    }),
    tasks: state.tasks.map((task) => {
      const original = overdueTasks.get(task.id);
      if (!original) return task;
      const manualScheduling = task.manualScheduling?.placementPolicy === 'flexibleBeforeDeadline'
        ? { ...task.manualScheduling, deadline: end }
        : task.manualScheduling;
      return {
        ...task,
        scheduledDate: reviewReleases.get(task.id) ?? task.scheduledDate,
        dueDate: task.dueDate && task.dueDate < today ? end : task.dueDate,
        manualScheduling,
      };
    }),
  };
  const result = generateBasePlanV2(adjustedState, context);

  const materialWarnings = [...overdueMaterials.values()].map((material) => ({
    code: 'OVERDUE_RECOVERY',
    targetId: material.id,
    message: `${material.name}は期限を${diffDays(material.targetDate, today)}日超過しています。未完了分を${today}〜${end}へ回復計画として再配置しました`,
  }));
  const taskWarnings = [...overdueTasks.values()].map((task) => ({
    code: 'OVERDUE_RECOVERY',
    targetId: task.id,
    message: `「${task.title}」は期限を${diffDays(taskDeadline(task)!, today)}日超過しています。未完了分を${today}〜${end}へ回復計画として再配置しました`,
  }));
  const overdueStrict = [...overdueMaterials.values()].filter((material) => material.deadlinePolicy === 'strict').length
    + [...overdueTasks.values()].filter((task) => task.manualScheduling?.placementPolicy === 'flexibleBeforeDeadline').length;
  const overdueNormalMinutes = result.deadlineReports.reduce((sum, report) => {
    const materialId = report.workItemId.startsWith('material:') ? report.workItemId.slice('material:'.length) : null;
    const material = materialId ? overdueMaterials.get(materialId) : undefined;
    return material?.deadlinePolicy === 'normal' ? sum + report.requiredMinutes : sum;
  }, 0);

  const scheduledMinutesForMaterial = (materialId: string) => result.scheduledTasks
    .filter((task) => task.materialId === materialId && task.sourceType === 'material')
    .reduce((sum, task) => sum + task.estimatedMinutes, 0);
  const scheduledMinutesForTask = (taskId: string) => result.scheduledTasks
    .filter((task) => task.id === taskId || task.sourceId === taskId)
    .reduce((sum, task) => sum + task.estimatedMinutes, 0);

  return {
    ...result,
    scheduledTasks: result.scheduledTasks.map((task) => {
      const material = task.materialId ? overdueMaterials.get(task.materialId) : undefined;
      const originalTask = originalTaskForOutput(overdueTasks, task);
      const restored = originalTask ? restoreTaskDeadline(task, originalTask) : task;
      return material ? { ...restored, dueDate: material.targetDate } : restored;
    }),
    deadlineReports: result.deadlineReports.map((report) => {
      const materialId = report.workItemId.startsWith('material:') ? report.workItemId.slice('material:'.length) : null;
      const material = materialId ? overdueMaterials.get(materialId) : undefined;
      if (material) {
        const scheduledMinutes = scheduledMinutesForMaterial(material.id);
        return {
          ...report,
          policy: material.deadlinePolicy,
          deadline: material.targetDate,
          feasible: material.deadlinePolicy === 'flexible' ? null : false,
          scheduledMinutes,
          shortageMinutes: Math.max(0, report.requiredMinutes - scheduledMinutes),
          overdueDays: diffDays(material.targetDate, today),
        };
      }
      const taskId = report.workItemId.startsWith('task:') ? report.workItemId.slice('task:'.length) : null;
      const originalTask = taskId ? overdueTasks.get(taskId) : undefined;
      const originalDeadline = originalTask ? taskDeadline(originalTask) : null;
      if (!originalTask || !originalDeadline) return report;
      const scheduledMinutes = scheduledMinutesForTask(originalTask.id);
      return {
        ...report,
        deadline: originalDeadline,
        feasible: false,
        scheduledMinutes,
        shortageMinutes: Math.max(0, report.requiredMinutes - scheduledMinutes),
        overdueDays: diffDays(originalDeadline, today),
      };
    }),
    objectiveReport: {
      ...result.objectiveReport,
      strictDeadlineViolations: result.objectiveReport.strictDeadlineViolations + overdueStrict,
      normalOverdueMinutes: result.objectiveReport.normalOverdueMinutes + overdueNormalMinutes,
    },
    warnings: [...materialWarnings, ...taskWarnings, ...result.warnings],
  };
}
