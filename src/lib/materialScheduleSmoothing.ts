import type {
  AppState,
  ISODate,
  Material,
  ScheduleGenerationResult,
  SchedulerContext,
  StudyTask,
} from '../types';
import { addDays, diffDays, hmToMinutes, minutesInTimeZone, minutesToHM, weekdayOf } from './date';
import {
  computeLoadBalanceMetrics,
  dateInTimeZone,
  mergeMinuteRanges,
  subtractMinuteRanges,
  validateGeneratedScheduleV2,
} from './schedulerV2';

interface MinuteRange {
  start: number;
  end: number;
}

interface DayModel {
  date: ISODate;
  freeRanges: MinuteRange[];
  budget: number;
  fixedMinutes: number;
  residualBudget: number;
}

interface MaterialBounds {
  material: Material;
  earliest: ISODate;
  finish: ISODate;
  safetyFinish: ISODate;
  dates: ISODate[];
  frozen: boolean;
}

interface MaterialMetrics {
  activeDays: number;
  targetDays: number;
  activeDayDeficit: number;
  maxDayMinutes: number;
  burstRatio: number;
  plateauDays: number;
  curveRmse: number;
  sameDayExcess: number;
  bufferMinutes: number;
}

interface DailyMetrics {
  maxMinutes: number;
  variance: number;
  adjacentDifference: number;
}

interface PackingResult {
  starts: Map<string, { start: number; end: number }>;
}

export interface MaterialConcentrationSummary {
  activeDays: number;
  sameDayExcess: number;
  maxDayMinutes: number;
}

const MAX_TARGET_MATERIALS = 8;
const MAX_TASKS_PER_MATERIAL = 12;
const MAX_DATES_PER_TASK = 8;
const MAX_SWAP_TASKS_PER_DATE = 8;
const MAX_OPTIMIZATION_PASSES = 6;
const EPSILON = 1e-7;

function isMovableMaterialTask(task: StudyTask): boolean {
  return task.status === 'planned'
    && task.sourceType === 'material'
    && task.generatedBy === 'auto'
    && task.type === 'new'
    && task.materialId !== null
    && (task.placementLock ?? 'none') === 'none'
    && Boolean(task.scheduledStart && task.scheduledEnd);
}

function isMaterialPlanTask(task: StudyTask): boolean {
  return task.status === 'planned'
    && task.type === 'new'
    && task.materialId !== null
    && task.sourceType === 'material';
}

function taskRangeStart(task: StudyTask): number {
  return task.materialRange?.start ?? task.rangeStart ?? Number.MAX_SAFE_INTEGER;
}

function taskSort(a: StudyTask, b: StudyTask): number {
  return taskRangeStart(a) - taskRangeStart(b)
    || (a.materialRange?.end ?? a.rangeEnd ?? Number.MAX_SAFE_INTEGER)
      - (b.materialRange?.end ?? b.rangeEnd ?? Number.MAX_SAFE_INTEGER)
    || a.id.localeCompare(b.id);
}

function datesBetween(start: ISODate, end: ISODate): ISODate[] {
  const result: ISODate[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) result.push(date);
  return result;
}

function clampDate(date: ISODate, start: ISODate, end: ISODate): ISODate {
  if (date < start) return start;
  if (date > end) return end;
  return date;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 1;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
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

function buildDayModels(
  state: AppState,
  result: ScheduleGenerationResult,
  context: SchedulerContext,
  movableIds: ReadonlySet<string>,
): Map<ISODate, DayModel> {
  const models = new Map<ISODate, DayModel>();
  const today = dateInTimeZone(context.now, context.timezone);
  const nowMinutes = Math.ceil(minutesInTimeZone(context.now, context.timezone) / 5) * 5;
  for (const date of datesBetween(result.capacityReport.horizonStart, result.capacityReport.horizonEnd)) {
    const override = state.dayPlans.find((plan) => plan.date === date);
    const availability = state.availability.find((slot) => slot.weekday === weekdayOf(date));
    const windows = override?.load === 'rest'
      ? []
      : override?.availabilityWindows ?? availability?.windows ?? [];
    const windowRanges = mergeMinuteRanges(windows.map((window) => ({
      start: hmToMinutes(window.start),
      end: hmToMinutes(window.end),
    })));
    const eventRanges = mergeMinuteRanges(fixedEventsOn(state, date).map((event) => ({
      start: hmToMinutes(event.start),
      end: hmToMinutes(event.end),
    })));
    let freeRanges = subtractMinuteRanges(windowRanges, eventRanges);
    if (date === today) {
      freeRanges = freeRanges
        .map((range) => ({ ...range, start: Math.max(range.start, nowMinutes) }))
        .filter((range) => range.end > range.start);
    }
    const availableMinutes = freeRanges.reduce((sum, range) => sum + range.end - range.start, 0);
    const configuredMinutes = override?.availabilityWindows
      ? availableMinutes
      : availability?.minutes ?? availableMinutes;
    const factor = override?.load === 'light' ? 0.6 : override?.load === 'heavy' ? 1.2 : 1;
    const budget = Math.max(0, Math.min(
      availableMinutes,
      Math.round(configuredMinutes * factor),
      state.settings.maxDailyMinutes,
    ));

    const fixedTasks = result.scheduledTasks.filter((task) =>
      task.status === 'planned'
      && task.scheduledDate === date
      && !movableIds.has(task.id));
    const fixedRanges = fixedTasks
      .filter((task) => task.scheduledStart && task.scheduledEnd)
      .map((task) => ({
        start: hmToMinutes(task.scheduledStart!),
        end: hmToMinutes(task.scheduledEnd!),
      }));
    freeRanges = subtractMinuteRanges(freeRanges, fixedRanges);
    const fixedMinutes = fixedTasks.reduce((sum, task) => sum + task.estimatedMinutes, 0);
    const residualByBudget = Math.max(0, budget - fixedMinutes);
    const residualByRanges = freeRanges.reduce((sum, range) => sum + range.end - range.start, 0);
    models.set(date, {
      date,
      freeRanges,
      budget,
      fixedMinutes,
      residualBudget: Math.min(residualByBudget, residualByRanges),
    });
  }
  return models;
}

function safetyFinishDate(material: Material, earliest: ISODate): ISODate {
  const span = Math.max(0, diffDays(earliest, material.targetDate));
  const baseReserve = span <= 7 ? 1 : span <= 21 ? 2 : span <= 60 ? 5 : Math.ceil(span * 0.12);
  const reserve = material.deadlinePolicy === 'strict' ? baseReserve + 1 : baseReserve;
  if (material.preferredFinishDate) {
    return clampDate(material.preferredFinishDate, earliest, material.targetDate);
  }
  return clampDate(addDays(material.targetDate, -reserve), earliest, material.targetDate);
}

function makeMaterialBounds(
  state: AppState,
  result: ScheduleGenerationResult,
  today: ISODate,
  dayModels: ReadonlyMap<ISODate, DayModel>,
  movableByMaterial: ReadonlyMap<string, StudyTask[]>,
): Map<string, MaterialBounds> {
  const bounds = new Map<string, MaterialBounds>();
  for (const material of state.materials) {
    const tasks = movableByMaterial.get(material.id) ?? [];
    if (tasks.length === 0) continue;
    const earliest = material.startDate > today ? material.startDate : today;
    const originalLatest = [...tasks].map((task) => task.scheduledDate).sort().pop() ?? material.targetDate;
    const frozen = material.targetDate < earliest;
    const safetyFinish = frozen ? originalLatest : safetyFinishDate(material, earliest);
    const finish = frozen
      ? originalLatest
      : material.deadlinePolicy === 'strict'
        ? originalLatest
        : clampDate(originalLatest > safetyFinish ? originalLatest : safetyFinish, earliest, material.targetDate);
    const clippedFinish = finish > result.capacityReport.horizonEnd
      ? result.capacityReport.horizonEnd
      : finish;
    const dates = clippedFinish < earliest
      ? []
      : datesBetween(earliest, clippedFinish).filter((date) => (dayModels.get(date)?.residualBudget ?? 0) > 0);
    bounds.set(material.id, { material, earliest, finish: clippedFinish, safetyFinish, dates, frozen });
  }
  return bounds;
}

function canPackDurations(durations: number[], capacities: number[]): boolean {
  const work = [...durations].filter((value) => value > 0).sort((a, b) => b - a);
  const initial = [...capacities].filter((value) => value > 0).sort((a, b) => b - a);
  if (work.length === 0) return true;
  if (initial.length === 0 || work.reduce((sum, value) => sum + value, 0) > initial.reduce((sum, value) => sum + value, 0)) return false;
  if (work[0] > initial[0]) return false;
  const memo = new Set<string>();
  const visit = (index: number, remaining: number[]): boolean => {
    if (index >= work.length) return true;
    const key = `${index}|${remaining.join(',')}`;
    if (memo.has(key)) return false;
    memo.add(key);
    const duration = work[index];
    const seen = new Set<number>();
    for (let slotIndex = 0; slotIndex < remaining.length; slotIndex += 1) {
      const capacity = remaining[slotIndex];
      if (capacity < duration || seen.has(capacity)) continue;
      seen.add(capacity);
      const next = [...remaining];
      next[slotIndex] -= duration;
      next.sort((a, b) => b - a);
      if (visit(index + 1, next)) return true;
    }
    return false;
  };
  return visit(0, initial);
}

function assignmentDate(
  task: StudyTask,
  assignment: ReadonlyMap<string, ISODate>,
): ISODate {
  return assignment.get(task.id) ?? task.scheduledDate;
}

function materialOrderValid(
  material: Material,
  tasks: StudyTask[],
  assignment: ReadonlyMap<string, ISODate>,
  originalDates: ReadonlyMap<string, ISODate>,
  bounds: MaterialBounds,
): boolean {
  let previous: ISODate | null = null;
  const usage = new Map<ISODate, { units: number; minutes: number }>();
  for (const task of [...tasks].sort(taskSort)) {
    const date = assignmentDate(task, assignment);
    if (date < bounds.earliest || date > bounds.finish) return false;
    if (material.deadlinePolicy === 'strict' && isMovableMaterialTask(task)) {
      const original = originalDates.get(task.id);
      // strictは元の実行可能解より後ろへ動かさない。各累積時点で進捗保証線を維持する。
      if (original && date > original) return false;
    }
    if (previous && date < previous) return false;
    previous = date;
    const day = usage.get(date) ?? { units: 0, minutes: 0 };
    day.units += task.amount;
    day.minutes += task.estimatedMinutes;
    usage.set(date, day);
  }
  for (const day of usage.values()) {
    if (material.maxUnitsPerDay !== undefined && day.units > material.maxUnitsPerDay) return false;
    if (material.maxMinutesPerDay !== undefined && day.minutes > material.maxMinutesPerDay) return false;
  }
  return true;
}

function makeDayFit(
  movableTasks: StudyTask[],
  dayModels: ReadonlyMap<ISODate, DayModel>,
  baselineMaxDailyMinutes: number,
) {
  const allowedIncrease = Math.max(15, Math.round(baselineMaxDailyMinutes * 0.03));
  const maxDailyMinutes = baselineMaxDailyMinutes + allowedIncrease;
  const cache = new Map<string, boolean>();
  return (assignment: ReadonlyMap<string, ISODate>, date: ISODate): boolean => {
    const day = dayModels.get(date);
    if (!day) return false;
    const durations = movableTasks
      .filter((task) => assignmentDate(task, assignment) === date)
      .map((task) => task.estimatedMinutes)
      .sort((a, b) => b - a);
    const key = `${date}|${durations.join(',')}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const movableMinutes = durations.reduce((sum, value) => sum + value, 0);
    const valid = movableMinutes <= day.residualBudget
      && day.fixedMinutes + movableMinutes <= maxDailyMinutes
      && canPackDurations(durations, day.freeRanges.map((range) => range.end - range.start));
    cache.set(key, valid);
    return valid;
  };
}

function targetActiveDays(
  bounds: MaterialBounds,
  tasks: StudyTask[],
): number {
  if (tasks.length === 0 || bounds.dates.length === 0) return 0;
  const durations = tasks.map((task) => task.estimatedMinutes);
  let preferredSessionMinutes = median(durations);
  if (bounds.material.dailyTarget) {
    preferredSessionMinutes = Math.max(1, bounds.material.dailyTarget * bounds.material.minutesPerUnit);
  } else if (bounds.material.weeklyTarget && bounds.material.preferredCadence?.type === 'timesPerWeek') {
    preferredSessionMinutes = Math.max(
      1,
      bounds.material.weeklyTarget * bounds.material.minutesPerUnit / Math.max(1, bounds.material.preferredCadence.count),
    );
  }
  const totalMinutes = durations.reduce((sum, value) => sum + value, 0);
  let target = Math.ceil(totalMinutes / Math.max(1, preferredSessionMinutes));
  if (bounds.material.preferredCadence?.type === 'daily') target = bounds.dates.length;
  if (bounds.material.preferredCadence?.type === 'timesPerWeek') {
    const weeks = new Set(bounds.dates.map((date) => addDays(date, -((weekdayOf(date) + 6) % 7))));
    target = Math.max(target, weeks.size * Math.max(1, bounds.material.preferredCadence.count));
  }
  return Math.max(1, Math.min(bounds.dates.length, tasks.length, target));
}

function concentrationMetrics(
  bounds: MaterialBounds,
  materialTasks: StudyTask[],
  assignment: ReadonlyMap<string, ISODate>,
  dayModels: ReadonlyMap<ISODate, DayModel>,
): MaterialMetrics {
  const byDate = new Map<ISODate, { minutes: number; count: number }>();
  let totalMinutes = 0;
  for (const task of materialTasks) {
    const date = assignmentDate(task, assignment);
    const current = byDate.get(date) ?? { minutes: 0, count: 0 };
    current.minutes += task.estimatedMinutes;
    current.count += 1;
    byDate.set(date, current);
    totalMinutes += task.estimatedMinutes;
  }
  const targetDays = targetActiveDays(bounds, materialTasks);
  const activeDays = byDate.size;
  const maxDayMinutes = Math.max(0, ...[...byDate.values()].map((value) => value.minutes));
  const idealDayMinutes = totalMinutes / Math.max(1, targetDays);
  const burstRatio = maxDayMinutes / Math.max(1, idealDayMinutes);
  const activeDates = [...byDate.keys()].sort();
  let plateauDays = 0;
  if (activeDates.length > 0 && bounds.dates.length > 0) {
    plateauDays = Math.max(0, diffDays(bounds.dates[0], activeDates[0]));
    for (let index = 1; index < activeDates.length; index += 1) {
      plateauDays = Math.max(plateauDays, Math.max(0, diffDays(activeDates[index - 1], activeDates[index]) - 1));
    }
  }
  const totalCapacity = bounds.dates.reduce((sum, date) => sum + (dayModels.get(date)?.budget ?? 0), 0);
  let cumulativeCapacity = 0;
  let cumulativeActual = 0;
  let squaredError = 0;
  for (const date of bounds.dates) {
    cumulativeCapacity += dayModels.get(date)?.budget ?? 0;
    cumulativeActual += byDate.get(date)?.minutes ?? 0;
    const target = totalCapacity > 0 ? totalMinutes * cumulativeCapacity / totalCapacity : totalMinutes;
    squaredError += ((cumulativeActual - target) / Math.max(1, totalMinutes) * 100) ** 2;
  }
  const curveRmse = bounds.dates.length > 0 ? Math.sqrt(squaredError / bounds.dates.length) : 0;
  const sameDayExcess = [...byDate.values()].reduce((sum, value) => sum + Math.max(0, value.count - 1), 0);
  const bufferMinutes = [...byDate.entries()]
    .filter(([date]) => date > bounds.safetyFinish)
    .reduce((sum, [, value]) => sum + value.minutes, 0);
  return {
    activeDays,
    targetDays,
    activeDayDeficit: Math.max(0, targetDays - activeDays),
    maxDayMinutes,
    burstRatio,
    plateauDays,
    curveRmse,
    sameDayExcess,
    bufferMinutes,
  };
}

function materialScore(metrics: MaterialMetrics, totalMinutes: number): number {
  return metrics.activeDayDeficit * 40
    + Math.max(0, metrics.burstRatio - 1.05) ** 2 * 60
    + metrics.curveRmse * 1.8
    + metrics.plateauDays * 3
    + metrics.sameDayExcess * 0.3
    + metrics.bufferMinutes / Math.max(1, totalMinutes) * 40;
}

function dailyMetrics(
  resultTasks: StudyTask[],
  movableIds: ReadonlySet<string>,
  assignment: ReadonlyMap<string, ISODate>,
): DailyMetrics {
  const load = new Map<ISODate, number>();
  for (const task of resultTasks) {
    if (task.status !== 'planned') continue;
    const date = movableIds.has(task.id) ? assignmentDate(task, assignment) : task.scheduledDate;
    load.set(date, (load.get(date) ?? 0) + task.estimatedMinutes);
  }
  const scheduledDates = [...load.keys()].sort();
  if (scheduledDates.length === 0) return { maxMinutes: 0, variance: 0, adjacentDifference: 0 };
  const dates = datesBetween(scheduledDates[0], scheduledDates[scheduledDates.length - 1]);
  const values = dates.map((date) => load.get(date) ?? 0);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    maxMinutes: Math.max(0, ...values),
    variance: values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length,
    adjacentDifference: values.slice(1).reduce((sum, value, index) => sum + Math.abs(value - values[index]), 0),
  };
}

function assignmentMovement(
  assignment: ReadonlyMap<string, ISODate>,
  originalDates: ReadonlyMap<string, ISODate>,
): { moved: number; shiftedDays: number } {
  let moved = 0;
  let shiftedDays = 0;
  for (const [taskId, original] of originalDates) {
    const next = assignment.get(taskId) ?? original;
    if (next === original) continue;
    moved += 1;
    shiftedDays += Math.abs(diffDays(original, next));
  }
  return { moved, shiftedDays };
}

function idealDateForTask(
  task: StudyTask,
  bounds: MaterialBounds,
  materialTasks: StudyTask[],
  dayModels: ReadonlyMap<ISODate, DayModel>,
): ISODate {
  const ordered = [...materialTasks].sort(taskSort);
  const index = Math.max(0, ordered.findIndex((entry) => entry.id === task.id));
  const targetRatio = (index + 0.5) / Math.max(1, ordered.length);
  const totalCapacity = bounds.dates.reduce((sum, date) => sum + (dayModels.get(date)?.budget ?? 0), 0);
  if (totalCapacity <= 0) return bounds.dates[Math.min(index, bounds.dates.length - 1)] ?? task.scheduledDate;
  let cumulative = 0;
  let best = bounds.dates[0] ?? task.scheduledDate;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const date of bounds.dates) {
    cumulative += dayModels.get(date)?.budget ?? 0;
    const distance = Math.abs(cumulative / totalCapacity - targetRatio);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = date;
    }
  }
  return best;
}

function plannedLoadByDate(
  resultTasks: StudyTask[],
  movableIds: ReadonlySet<string>,
  assignment: ReadonlyMap<string, ISODate>,
): Map<ISODate, number> {
  const load = new Map<ISODate, number>();
  for (const task of resultTasks) {
    if (task.status !== 'planned') continue;
    const date = movableIds.has(task.id) ? assignmentDate(task, assignment) : task.scheduledDate;
    load.set(date, (load.get(date) ?? 0) + task.estimatedMinutes);
  }
  return load;
}

function timePreferenceViolations(state: AppState, tasks: StudyTask[]): number {
  let violations = 0;
  for (const task of tasks) {
    if (!task.materialId || !task.scheduledStart || !task.scheduledEnd) continue;
    const material = state.materials.find((item) => item.id === task.materialId);
    const windows = material?.preferredTimeWindows?.filter((window) => window.preference > 0) ?? [];
    if (windows.length === 0) continue;
    const start = hmToMinutes(task.scheduledStart);
    const end = hmToMinutes(task.scheduledEnd);
    if (!windows.some((window) => start < hmToMinutes(window.end) && end > hmToMinutes(window.start))) violations += 1;
  }
  return violations;
}

function countTaskSwitches(tasks: StudyTask[]): number {
  const planned = tasks
    .filter((task) => task.status === 'planned' && task.scheduledStart)
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)
      || hmToMinutes(a.scheduledStart!) - hmToMinutes(b.scheduledStart!)
      || a.id.localeCompare(b.id));
  let switches = 0;
  for (let index = 1; index < planned.length; index += 1) {
    if (planned[index - 1].scheduledDate === planned[index].scheduledDate
      && planned[index - 1].materialId !== planned[index].materialId) switches += 1;
  }
  return switches;
}

function countSameMaterialStreaks(tasks: StudyTask[]): number {
  const planned = tasks
    .filter((task) => task.status === 'planned' && task.scheduledStart)
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)
      || hmToMinutes(a.scheduledStart!) - hmToMinutes(b.scheduledStart!)
      || a.id.localeCompare(b.id));
  let streaks = 0;
  for (let index = 1; index < planned.length; index += 1) {
    if (planned[index - 1].scheduledDate === planned[index].scheduledDate
      && planned[index].materialId !== null
      && planned[index - 1].materialId === planned[index].materialId) streaks += 1;
  }
  return streaks;
}

function assignTasksToSlots(
  state: AppState,
  tasks: StudyTask[],
  ranges: MinuteRange[],
): PackingResult | null {
  const ordered = [...tasks].sort((a, b) => b.estimatedMinutes - a.estimatedMinutes || taskSort(a, b));
  const capacities = ranges.map((range) => range.end - range.start);
  const slotByTask = new Map<string, number>();
  const memo = new Set<string>();
  const visit = (index: number, remaining: number[]): boolean => {
    if (index >= ordered.length) return true;
    const key = `${index}|${remaining.join(',')}`;
    if (memo.has(key)) return false;
    memo.add(key);
    const task = ordered[index];
    const material = task.materialId ? state.materials.find((item) => item.id === task.materialId) : undefined;
    const preferred = material?.preferredTimeWindows?.filter((window) => window.preference > 0) ?? [];
    const candidates = remaining
      .map((capacity, slotIndex) => {
        const range = ranges[slotIndex];
        const preference = preferred.some((window) =>
          range.start < hmToMinutes(window.end) && range.end > hmToMinutes(window.start)) ? 0 : 1;
        return { capacity, slotIndex, preference };
      })
      .filter((candidate) => candidate.capacity >= task.estimatedMinutes)
      .sort((a, b) => a.preference - b.preference
        || a.capacity - b.capacity
        || a.slotIndex - b.slotIndex);
    const seen = new Set<number>();
    for (const candidate of candidates) {
      if (seen.has(candidate.capacity)) continue;
      seen.add(candidate.capacity);
      const next = [...remaining];
      next[candidate.slotIndex] -= task.estimatedMinutes;
      slotByTask.set(task.id, candidate.slotIndex);
      if (visit(index + 1, next)) return true;
      slotByTask.delete(task.id);
    }
    return false;
  };
  if (!visit(0, capacities)) return null;

  const starts = new Map<string, { start: number; end: number }>();
  for (let slotIndex = 0; slotIndex < ranges.length; slotIndex += 1) {
    const inSlot = tasks.filter((task) => slotByTask.get(task.id) === slotIndex);
    let cursor = ranges[slotIndex].start;
    const remaining = [...inSlot];
    while (remaining.length > 0) {
      remaining.sort((a, b) => {
        const violation = (task: StudyTask) => {
          const material = task.materialId ? state.materials.find((item) => item.id === task.materialId) : undefined;
          const windows = material?.preferredTimeWindows?.filter((window) => window.preference > 0) ?? [];
          if (windows.length === 0) return 0;
          return windows.some((window) => cursor < hmToMinutes(window.end)
            && cursor + task.estimatedMinutes > hmToMinutes(window.start)) ? 0 : 1;
        };
        return violation(a) - violation(b)
          || Math.abs(cursor - (a.scheduledStart ? hmToMinutes(a.scheduledStart) : cursor))
            - Math.abs(cursor - (b.scheduledStart ? hmToMinutes(b.scheduledStart) : cursor))
          || taskSort(a, b);
      });
      const task = remaining.shift()!;
      starts.set(task.id, { start: cursor, end: cursor + task.estimatedMinutes });
      cursor += task.estimatedMinutes;
    }
    if (cursor > ranges[slotIndex].end) return null;
  }
  return { starts };
}

function summarizeMaterialInternal(tasks: StudyTask[], materialId: string): MaterialConcentrationSummary {
  const byDate = new Map<ISODate, { count: number; minutes: number }>();
  for (const task of tasks) {
    if (task.status !== 'planned' || task.materialId !== materialId || task.sourceType !== 'material' || task.type !== 'new') continue;
    const current = byDate.get(task.scheduledDate) ?? { count: 0, minutes: 0 };
    current.count += 1;
    current.minutes += task.estimatedMinutes;
    byDate.set(task.scheduledDate, current);
  }
  return {
    activeDays: byDate.size,
    sameDayExcess: [...byDate.values()].reduce((sum, value) => sum + Math.max(0, value.count - 1), 0),
    maxDayMinutes: Math.max(0, ...[...byDate.values()].map((value) => value.minutes)),
  };
}

export function summarizeMaterialConcentration(tasks: StudyTask[], materialId: string): MaterialConcentrationSummary {
  return summarizeMaterialInternal(tasks, materialId);
}

/**
 * 既存ソルバーの期限・固定・チャンク保証を壊さず、生成済みの教材セッションを
 * 日付単位で局所移動・交換する。strictは各チャンクを元の実行可能解より後ろへ
 * 動かさないため、最遅解から得た累積期限保証線も維持される。
 */
export function smoothMaterialSchedule(
  state: AppState,
  result: ScheduleGenerationResult,
  context: SchedulerContext,
): ScheduleGenerationResult {
  if (result.status !== 'success' && result.status !== 'partial') return result;
  const movableTasks = result.scheduledTasks.filter(isMovableMaterialTask);
  if (movableTasks.length < 2) return result;
  const movableIds = new Set(movableTasks.map((task) => task.id));
  const originalDates = new Map(movableTasks.map((task) => [task.id, task.scheduledDate] as const));
  const assignment = new Map(originalDates);
  const materialById = new Map(state.materials.map((material) => [material.id, material] as const));
  const movableByMaterial = new Map<string, StudyTask[]>();
  const planTasksByMaterial = new Map<string, StudyTask[]>();
  for (const task of result.scheduledTasks.filter(isMaterialPlanTask)) {
    planTasksByMaterial.set(task.materialId!, [...(planTasksByMaterial.get(task.materialId!) ?? []), task]);
    if (movableIds.has(task.id)) movableByMaterial.set(task.materialId!, [...(movableByMaterial.get(task.materialId!) ?? []), task]);
  }
  for (const tasks of planTasksByMaterial.values()) tasks.sort(taskSort);
  for (const tasks of movableByMaterial.values()) tasks.sort(taskSort);

  const today = dateInTimeZone(context.now, context.timezone);
  const dayModels = buildDayModels(state, result, context, movableIds);
  const boundsByMaterial = makeMaterialBounds(state, result, today, dayModels, movableByMaterial);
  const baselineDaily = dailyMetrics(result.scheduledTasks, movableIds, assignment);
  const dayFits = makeDayFit(movableTasks, dayModels, baselineDaily.maxMinutes);
  if (![...new Set([...assignment.values()])].every((date) => dayFits(assignment, date))) return result;

  const scoreForMaterial = (materialId: string, candidate: ReadonlyMap<string, ISODate>): number => {
    const bounds = boundsByMaterial.get(materialId);
    const tasks = planTasksByMaterial.get(materialId) ?? [];
    if (!bounds || tasks.length === 0) return 0;
    return materialScore(
      concentrationMetrics(bounds, tasks, candidate, dayModels),
      tasks.reduce((sum, task) => sum + task.estimatedMinutes, 0),
    );
  };
  const pairValue = (candidate: ReadonlyMap<string, ISODate>, materialIds: string[]): number => {
    const materialPart = [...new Set(materialIds)].reduce((sum, materialId) => sum + scoreForMaterial(materialId, candidate), 0);
    const daily = dailyMetrics(result.scheduledTasks, movableIds, candidate);
    const movement = assignmentMovement(candidate, originalDates);
    return materialPart
      + daily.variance * 0.003
      + daily.adjacentDifference * 0.02
      + movement.moved * 0.15
      + movement.shiftedDays * 0.03;
  };
  const globalAcceptable = (candidate: ReadonlyMap<string, ISODate>): boolean => {
    const daily = dailyMetrics(result.scheduledTasks, movableIds, candidate);
    return daily.maxMinutes <= baselineDaily.maxMinutes + Math.max(15, Math.round(baselineDaily.maxMinutes * 0.03))
      && daily.variance <= baselineDaily.variance * 1.15 + 100
      && daily.adjacentDifference <= baselineDaily.adjacentDifference * 1.2 + 30;
  };
  const materialValid = (materialId: string, candidate: ReadonlyMap<string, ISODate>): boolean => {
    const material = materialById.get(materialId);
    const bounds = boundsByMaterial.get(materialId);
    const tasks = planTasksByMaterial.get(materialId) ?? [];
    return Boolean(material && bounds && materialOrderValid(material, tasks, candidate, originalDates, bounds));
  };

  const initialMaterialScores = [...boundsByMaterial.keys()]
    .map((materialId) => {
      const bounds = boundsByMaterial.get(materialId)!;
      const tasks = planTasksByMaterial.get(materialId) ?? [];
      const metrics = concentrationMetrics(bounds, tasks, assignment, dayModels);
      return { materialId, metrics, score: scoreForMaterial(materialId, assignment) };
    })
    .filter((entry) => (movableByMaterial.get(entry.materialId)?.length ?? 0) > 1
      && (entry.metrics.activeDayDeficit > 0
        || entry.metrics.sameDayExcess > 0
        || entry.metrics.burstRatio > 1.1
        || entry.metrics.curveRmse >= 5
        || entry.metrics.plateauDays >= 3))
    .sort((a, b) => b.score - a.score || a.materialId.localeCompare(b.materialId))
    .slice(0, MAX_TARGET_MATERIALS)
    .map((entry) => entry.materialId);
  if (initialMaterialScores.length === 0) return result;

  let current = new Map(assignment);
  for (let pass = 0; pass < MAX_OPTIMIZATION_PASSES; pass += 1) {
    let improved = false;
    const targets = [...initialMaterialScores]
      .sort((a, b) => scoreForMaterial(b, current) - scoreForMaterial(a, current) || a.localeCompare(b));
    for (const materialId of targets) {
      const bounds = boundsByMaterial.get(materialId);
      const materialTasks = planTasksByMaterial.get(materialId) ?? [];
      const movable = movableByMaterial.get(materialId) ?? [];
      if (!bounds || bounds.frozen || movable.length === 0) continue;
      const dateCounts = new Map<ISODate, number>();
      for (const task of materialTasks) {
        const date = assignmentDate(task, current);
        dateCounts.set(date, (dateCounts.get(date) ?? 0) + 1);
      }
      const rankedTasks = [...movable]
        .map((task) => {
          const ideal = idealDateForTask(task, bounds, materialTasks, dayModels);
          return {
            task,
            duplicate: (dateCounts.get(assignmentDate(task, current)) ?? 0) > 1 ? 1 : 0,
            displacement: Math.abs(diffDays(ideal, assignmentDate(task, current))),
          };
        })
        .sort((a, b) => b.duplicate - a.duplicate
          || b.displacement - a.displacement
          || taskSort(a.task, b.task))
        .slice(0, MAX_TASKS_PER_MATERIAL)
        .map((entry) => entry.task);

      let best: { value: number; assignment: Map<string, ISODate> } | null = null;
      const currentValue = pairValue(current, [materialId]);
      const currentMaterialScore = scoreForMaterial(materialId, current);
      for (const task of rankedTasks) {
        const ordered = materialTasks;
        const taskIndex = ordered.findIndex((entry) => entry.id === task.id);
        const previousDate = taskIndex > 0 ? assignmentDate(ordered[taskIndex - 1], current) : bounds.earliest;
        const nextDate = taskIndex + 1 < ordered.length ? assignmentDate(ordered[taskIndex + 1], current) : bounds.finish;
        const strictLatest = bounds.material.deadlinePolicy === 'strict'
          ? originalDates.get(task.id) ?? bounds.finish
          : bounds.finish;
        const lower = previousDate > bounds.earliest ? previousDate : bounds.earliest;
        const upperBase = nextDate < bounds.finish ? nextDate : bounds.finish;
        const upper = strictLatest < upperBase ? strictLatest : upperBase;
        if (upper < lower) continue;
        const ideal = idealDateForTask(task, bounds, materialTasks, dayModels);
        const loads = plannedLoadByDate(result.scheduledTasks, movableIds, current);
        const candidateDates = bounds.dates
          .filter((date) => date >= lower && date <= upper && date !== assignmentDate(task, current))
          .sort((a, b) => {
            const aHasMaterial = materialTasks.some((entry) => assignmentDate(entry, current) === a) ? 1 : 0;
            const bHasMaterial = materialTasks.some((entry) => assignmentDate(entry, current) === b) ? 1 : 0;
            const aRatio = (loads.get(a) ?? 0) / Math.max(1, dayModels.get(a)?.budget ?? 1);
            const bRatio = (loads.get(b) ?? 0) / Math.max(1, dayModels.get(b)?.budget ?? 1);
            return aHasMaterial - bHasMaterial
              || Math.abs(diffDays(ideal, a)) - Math.abs(diffDays(ideal, b))
              || aRatio - bRatio
              || a.localeCompare(b);
          })
          .slice(0, MAX_DATES_PER_TASK);

        for (const nextDateCandidate of candidateDates) {
          const sourceDate = assignmentDate(task, current);
          const moved = new Map(current);
          moved.set(task.id, nextDateCandidate);
          if (materialValid(materialId, moved)
            && dayFits(moved, sourceDate)
            && dayFits(moved, nextDateCandidate)
            && globalAcceptable(moved)) {
            const nextMaterialScore = scoreForMaterial(materialId, moved);
            const value = pairValue(moved, [materialId]);
            if (nextMaterialScore + EPSILON < currentMaterialScore
              && value + EPSILON < currentValue
              && (!best || value < best.value - EPSILON)) best = { value, assignment: moved };
          }

          const swapCandidates = movableTasks
            .filter((other) => other.id !== task.id && assignmentDate(other, current) === nextDateCandidate)
            .sort((a, b) => Math.abs(a.estimatedMinutes - task.estimatedMinutes)
              - Math.abs(b.estimatedMinutes - task.estimatedMinutes)
              || a.id.localeCompare(b.id))
            .slice(0, MAX_SWAP_TASKS_PER_DATE);
          for (const other of swapCandidates) {
            const otherMaterialId = other.materialId!;
            const swapped = new Map(current);
            swapped.set(task.id, nextDateCandidate);
            swapped.set(other.id, sourceDate);
            if (!materialValid(materialId, swapped)
              || !materialValid(otherMaterialId, swapped)
              || !dayFits(swapped, sourceDate)
              || !dayFits(swapped, nextDateCandidate)
              || !globalAcceptable(swapped)) continue;
            const beforeOther = scoreForMaterial(otherMaterialId, current);
            const afterOther = scoreForMaterial(otherMaterialId, swapped);
            const beforePair = pairValue(current, [materialId, otherMaterialId]);
            const afterPair = pairValue(swapped, [materialId, otherMaterialId]);
            const toleratedOtherRegression = Math.max(2, beforeOther * 0.05);
            if (scoreForMaterial(materialId, swapped) + EPSILON >= currentMaterialScore
              || afterOther > beforeOther + toleratedOtherRegression
              || afterPair + EPSILON >= beforePair) continue;
            if (!best || afterPair < best.value - EPSILON) best = { value: afterPair, assignment: swapped };
          }
        }
      }
      if (best) {
        current = best.assignment;
        improved = true;
      }
    }
    if (!improved) break;
  }

  const movement = assignmentMovement(current, originalDates);
  if (movement.moved === 0) return result;
  const changedDates = new Set<ISODate>();
  for (const [taskId, original] of originalDates) {
    const next = current.get(taskId) ?? original;
    if (next !== original) {
      changedDates.add(original);
      changedDates.add(next);
    }
  }
  const nextTasks = result.scheduledTasks.map((task) => movableIds.has(task.id)
    ? { ...task, scheduledDate: current.get(task.id) ?? task.scheduledDate }
    : task);
  for (const date of [...changedDates].sort()) {
    const day = dayModels.get(date);
    if (!day) return result;
    const tasks = nextTasks.filter((task) => movableIds.has(task.id) && task.scheduledDate === date);
    const packed = assignTasksToSlots(state, tasks, day.freeRanges);
    if (!packed) return result;
    for (const task of nextTasks) {
      const slot = packed.starts.get(task.id);
      if (!slot) continue;
      task.scheduledStart = minutesToHM(slot.start);
      task.scheduledEnd = minutesToHM(slot.end);
    }
  }

  const previousTimeViolations = timePreferenceViolations(state, result.scheduledTasks);
  const nextTimeViolations = timePreferenceViolations(state, nextTasks);
  if (nextTimeViolations > previousTimeViolations) return result;
  const safetyFinishByMaterial = new Map(
    [...boundsByMaterial.entries()].map(([materialId, bounds]) => [materialId, bounds.safetyFinish] as const),
  );
  const balance = computeLoadBalanceMetrics(state, nextTasks, safetyFinishByMaterial);
  if (balance.safetyBufferViolationMinutes > result.objectiveReport.safetyBufferViolationMinutes) return result;
  const candidate: ScheduleGenerationResult = {
    ...result,
    scheduledTasks: nextTasks,
    objectiveReport: {
      ...result.objectiveReport,
      ...balance,
      timePreferenceViolations: nextTimeViolations,
      taskSwitches: countTaskSwitches(nextTasks),
      sameMaterialStreak: countSameMaterialStreaks(nextTasks),
    },
  };
  if (validateGeneratedScheduleV2(state, candidate, context).length > 0) return result;
  return candidate;
}
