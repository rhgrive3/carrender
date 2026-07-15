import type {
  AppState,
  ISODate,
  Material,
  ScheduleGenerationResult,
  SchedulerContext,
  StudyTask,
  UnitRange,
} from '../types';
import {
  addDays,
  diffDays,
  hmToMinutes,
  minutesInTimeZone,
  weekdayOf,
} from './date';
import {
  dateInTimeZone,
  mergeMinuteRanges,
  normalizeUnitRanges,
  remainingUnitRanges,
  subtractMinuteRanges,
  sumRangeLengths,
} from './schedulerV2';
import { minutesForUnits } from './strictSolver';

export interface AutomaticSpreadCap {
  materialId: string;
  remainingUnits: number;
  safetyFinishDate: ISODate;
  eligibleDays: number;
  maxUnitsPerDay: number;
  maxMinutesPerDay: number;
}

export interface MaterialSpreadScore {
  sameDayExtraChunks: number;
  maxDailySharePpm: number;
  squaredDailySharePpm: number;
  maxMaterialDayMinutes: number;
}

interface CapacityDay {
  date: ISODate;
  minutes: number;
  unitCapacity: number;
}

function taskRange(task: StudyTask): UnitRange | null {
  const range = task.materialRange
    ?? (Number.isInteger(task.rangeStart) && Number.isInteger(task.rangeEnd)
      ? { start: task.rangeStart!, end: task.rangeEnd! }
      : null);
  if (!range || range.start < 1 || range.start > range.end) return null;
  return { start: range.start, end: range.end };
}

function removeClaimedRanges(ranges: UnitRange[], claimed: UnitRange[]): UnitRange[] {
  let result = ranges.map((range) => ({ ...range }));
  for (const claim of normalizeUnitRanges(claimed)) {
    result = result.flatMap((range) => {
      if (claim.end < range.start || claim.start > range.end) return [range];
      const pieces: UnitRange[] = [];
      if (claim.start > range.start) pieces.push({ start: range.start, end: claim.start - 1 });
      if (claim.end < range.end) pieces.push({ start: claim.end + 1, end: range.end });
      return pieces;
    });
  }
  return result;
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

function capacityOn(state: AppState, date: ISODate, context: SchedulerContext): number {
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
  let free = subtractMinuteRanges(windowRanges, eventRanges);
  if (date === dateInTimeZone(context.now, context.timezone)) {
    const roundedNow = Math.ceil(minutesInTimeZone(context.now, context.timezone) / 5) * 5;
    free = free
      .map((range) => ({ ...range, start: Math.max(range.start, roundedNow) }))
      .filter((range) => range.start < range.end);
  }
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

function claimedRangesForMaterial(state: AppState, materialId: string): UnitRange[] {
  const ranges: UnitRange[] = [];
  for (const task of state.tasks) {
    if (task.materialId !== materialId) continue;
    const countsAsClaim = task.status === 'done'
      || task.status === 'doing'
      || (task.status === 'planned' && (task.placementLock === 'date' || task.placementLock === 'time'))
      || (task.status === 'planned' && task.manualScheduling?.progressPolicy.type === 'countTowardMaterial');
    if (!countsAsClaim) continue;
    const range = taskRange(task);
    if (range) ranges.push(range);
  }
  return ranges;
}

function remainingUnitsForMaterial(state: AppState, material: Material): number {
  const total = Math.max(0, Math.floor(material.totalUnits ?? material.totalAmount));
  if (total <= 0) return 0;
  try {
    const completed = normalizeUnitRanges(
      material.completedRanges
        ?? (material.doneAmount > 0 ? [{ start: 1, end: Math.min(total, material.doneAmount) }] : []),
      total,
    );
    const remaining = remainingUnitRanges(total, completed);
    return sumRangeLengths(removeClaimedRanges(remaining, claimedRangesForMaterial(state, material.id)));
  } catch {
    return Math.max(0, total - Math.max(0, Math.floor(material.doneAmount)));
  }
}

function initialSafetyFinishDate(material: Material, start: ISODate): ISODate {
  if (material.preferredFinishDate) {
    if (material.preferredFinishDate < start) return start;
    if (material.preferredFinishDate > material.targetDate) return material.targetDate;
    return material.preferredFinishDate;
  }
  const span = Math.max(0, diffDays(start, material.targetDate));
  const baseReserve = span <= 7 ? 1 : span <= 21 ? 2 : span <= 60 ? 5 : Math.ceil(span * 0.12);
  const reserve = material.deadlinePolicy === 'strict' ? baseReserve + 1 : baseReserve;
  const finish = addDays(material.targetDate, -reserve);
  return finish < start ? start : finish;
}

function preferredUnitsPerStudyDay(state: AppState, material: Material, eligibleDays: number): number {
  const step = Math.max(1, Math.floor(material.unitStep ?? 1));
  const minimum = Math.max(step, Math.floor(material.minimumChunkUnits ?? step));
  if (material.dailyTarget && material.dailyTarget > 0) {
    return Math.max(minimum, Math.ceil(material.dailyTarget / step) * step);
  }
  if (material.weeklyTarget && material.weeklyTarget > 0) {
    const estimatedWeeks = Math.max(1, Math.ceil(eligibleDays / 7));
    const activeDaysPerWeek = Math.max(1, Math.ceil(eligibleDays / estimatedWeeks));
    return Math.max(minimum, Math.ceil((material.weeklyTarget / activeDaysPerWeek) / step) * step);
  }
  const sessionUnits = Math.floor(state.settings.sessionMaxMinutes / Math.max(material.minutesPerUnit, 0.0001));
  return Math.max(minimum, Math.max(step, Math.floor(sessionUnits / step) * step));
}

function deriveCap(
  state: AppState,
  material: Material,
  context: SchedulerContext,
): AutomaticSpreadCap | null {
  if (material.paused || material.archived || material.splittable === false) return null;
  // 利用者が明示した上限は自動値で上書きしない。
  if (material.maxUnitsPerDay !== undefined || material.maxMinutesPerDay !== undefined) return null;
  const remainingUnits = remainingUnitsForMaterial(state, material);
  if (remainingUnits <= 1) return null;

  const today = dateInTimeZone(context.now, context.timezone);
  const start = material.startDate > today ? material.startDate : today;
  if (material.targetDate < start) return null;
  const minimumChunkUnits = Math.max(1, Math.floor(material.minimumChunkUnits ?? material.unitStep ?? 1));
  const minimumChunkMinutes = minutesForUnits(material.minutesPerUnit, minimumChunkUnits);
  const requiredMinutes = minutesForUnits(material.minutesPerUnit, remainingUnits);
  let safetyFinishDate = initialSafetyFinishDate(material, start);
  const capacityThrough = (end: ISODate) => {
    let total = 0;
    for (let date = start; date <= end; date = addDays(date, 1)) total += capacityOn(state, date, context);
    return total;
  };
  while (safetyFinishDate < material.targetDate && capacityThrough(safetyFinishDate) < requiredMinutes) {
    safetyFinishDate = addDays(safetyFinishDate, 1);
  }

  const days: CapacityDay[] = [];
  for (let date = start; date <= safetyFinishDate; date = addDays(date, 1)) {
    const minutes = capacityOn(state, date, context);
    const unitCapacity = Math.floor(minutes / Math.max(material.minutesPerUnit, 0.0001));
    if (minutes >= minimumChunkMinutes && unitCapacity > 0) days.push({ date, minutes, unitCapacity });
  }
  if (days.length < 2) return null;

  const step = Math.max(1, Math.floor(material.unitStep ?? 1));
  const preferred = preferredUnitsPerStudyDay(state, material, days.length);
  let capUnits = Math.max(step, Math.ceil(preferred / step) * step);
  const capacityWithCap = (candidate: number) => days.reduce(
    (sum, day) => sum + Math.min(day.unitCapacity, candidate),
    0,
  );
  while (capUnits < remainingUnits && capacityWithCap(capUnits) < remainingUnits) capUnits += step;
  capUnits = Math.min(remainingUnits, capUnits);

  const unconstrainedLargestDay = Math.max(...days.map((day) => day.unitCapacity));
  if (capUnits >= remainingUnits || capUnits >= unconstrainedLargestDay) return null;
  return {
    materialId: material.id,
    remainingUnits,
    safetyFinishDate,
    eligibleDays: days.length,
    maxUnitsPerDay: capUnits,
    maxMinutesPerDay: minutesForUnits(material.minutesPerUnit, capUnits),
  };
}

function stateWithCaps(state: AppState, caps: ReadonlyArray<AutomaticSpreadCap>): AppState {
  if (caps.length === 0) return state;
  const byMaterial = new Map(caps.map((cap) => [cap.materialId, cap]));
  return {
    ...state,
    materials: state.materials.map((material) => {
      const cap = byMaterial.get(material.id);
      return cap ? { ...material, maxUnitsPerDay: cap.maxUnitsPerDay } : material;
    }),
  };
}

export function applyAutomaticSpreadCaps(
  state: AppState,
  context: SchedulerContext,
): { state: AppState; caps: AutomaticSpreadCap[] } {
  const caps = state.materials
    .map((material) => deriveCap(state, material, context))
    .filter((cap): cap is AutomaticSpreadCap => cap !== null);
  return { state: stateWithCaps(state, caps), caps };
}

export function computeMaterialSpreadScore(result: ScheduleGenerationResult): MaterialSpreadScore {
  const byMaterial = new Map<string, { total: number; taskCount: number; byDate: Map<ISODate, { minutes: number; count: number }> }>();
  for (const task of result.scheduledTasks) {
    if (task.status !== 'planned' || !task.materialId || task.sourceType !== 'material' || task.type !== 'new') continue;
    const entry = byMaterial.get(task.materialId) ?? { total: 0, taskCount: 0, byDate: new Map() };
    entry.total += task.estimatedMinutes;
    entry.taskCount += 1;
    const day = entry.byDate.get(task.scheduledDate) ?? { minutes: 0, count: 0 };
    day.minutes += task.estimatedMinutes;
    day.count += 1;
    entry.byDate.set(task.scheduledDate, day);
    byMaterial.set(task.materialId, entry);
  }

  let sameDayExtraChunks = 0;
  let maxDailySharePpm = 0;
  let squaredDailySharePpm = 0;
  let maxMaterialDayMinutes = 0;
  for (const entry of byMaterial.values()) {
    if (entry.total <= 0 || entry.taskCount < 2) continue;
    let squaredShare = 0;
    for (const day of entry.byDate.values()) {
      sameDayExtraChunks += Math.max(0, day.count - 1);
      const share = day.minutes / entry.total;
      squaredShare += share * share;
      maxDailySharePpm = Math.max(maxDailySharePpm, Math.round(share * 1_000_000));
      maxMaterialDayMinutes = Math.max(maxMaterialDayMinutes, day.minutes);
    }
    squaredDailySharePpm += Math.round(squaredShare * 1_000_000);
  }
  return { sameDayExtraChunks, maxDailySharePpm, squaredDailySharePpm, maxMaterialDayMinutes };
}

function statusRank(status: ScheduleGenerationResult['status']): number {
  return status === 'success' ? 0
    : status === 'partial' ? 1
      : status === 'infeasible' ? 2
        : status === 'indeterminate' ? 3
          : status === 'conflict' ? 4
            : 5;
}

function compareNumbers(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function compareHardOutcomes(a: ScheduleGenerationResult, b: ScheduleGenerationResult): number {
  return compareNumbers([
    statusRank(a.status),
    a.objectiveReport.strictDeadlineViolations,
    a.objectiveReport.lockViolations,
    a.objectiveReport.unscheduledStrictMinutes,
    a.objectiveReport.normalOverdueMinutes,
    a.objectiveReport.unscheduledMinutes,
    a.objectiveReport.progressDebtMinutes,
    a.objectiveReport.safetyBufferViolationMinutes,
  ], [
    statusRank(b.status),
    b.objectiveReport.strictDeadlineViolations,
    b.objectiveReport.lockViolations,
    b.objectiveReport.unscheduledStrictMinutes,
    b.objectiveReport.normalOverdueMinutes,
    b.objectiveReport.unscheduledMinutes,
    b.objectiveReport.progressDebtMinutes,
    b.objectiveReport.safetyBufferViolationMinutes,
  ]);
}

function compareSpread(a: ScheduleGenerationResult, b: ScheduleGenerationResult): number {
  const left = computeMaterialSpreadScore(a);
  const right = computeMaterialSpreadScore(b);
  return compareNumbers([
    left.sameDayExtraChunks,
    left.maxDailySharePpm,
    left.squaredDailySharePpm,
    left.maxMaterialDayMinutes,
    a.objectiveReport.maxDailyMinutes,
    a.objectiveReport.dailyLoadVariance,
    a.objectiveReport.adjacentDayDifference,
  ], [
    right.sameDayExtraChunks,
    right.maxDailySharePpm,
    right.squaredDailySharePpm,
    right.maxMaterialDayMinutes,
    b.objectiveReport.maxDailyMinutes,
    b.objectiveReport.dailyLoadVariance,
    b.objectiveReport.adjacentDayDifference,
  ]);
}

function capSignature(caps: ReadonlyArray<AutomaticSpreadCap>): string {
  return caps.map((cap) => `${cap.materialId}:${cap.maxUnitsPerDay}`).sort().join('|');
}

/**
 * 自動上限は利用者設定を書き換えず、生成時だけ適用する。まず全教材を試し、
 * 上位保証が悪化する場合は短期限・厳守、厳守のみへ段階的に緩和する。
 * どの候補も従来結果より悪い場合は従来結果をそのまま返す。
 */
export function generateWithAutomaticSpreadCaps(
  state: AppState,
  context: SchedulerContext,
  generate: (input: AppState, schedulerContext: SchedulerContext) => ScheduleGenerationResult,
): ScheduleGenerationResult {
  const applied = applyAutomaticSpreadCaps(state, context);
  if (applied.caps.length === 0) return generate(state, context);

  const baseline = generate(state, context);
  const today = dateInTimeZone(context.now, context.timezone);
  const materialById = new Map(state.materials.map((material) => [material.id, material]));
  const urgentCaps = applied.caps.filter((cap) => {
    const material = materialById.get(cap.materialId);
    return material?.deadlinePolicy === 'strict'
      || Boolean(material && diffDays(today, material.targetDate) <= 14);
  });
  const strictCaps = applied.caps.filter((cap) => materialById.get(cap.materialId)?.deadlinePolicy === 'strict');
  const strategies = [applied.caps, urgentCaps, strictCaps]
    .filter((caps) => caps.length > 0);
  const seen = new Set<string>();
  let best = baseline;

  for (const caps of strategies) {
    const signature = capSignature(caps);
    if (seen.has(signature)) continue;
    seen.add(signature);
    const candidate = generate(stateWithCaps(state, caps), context);
    // baselineより上位保証を悪化させる候補は採用しない。
    if (compareHardOutcomes(candidate, baseline) > 0) continue;
    const hardComparedWithBest = compareHardOutcomes(candidate, best);
    if (hardComparedWithBest < 0
      || (hardComparedWithBest === 0 && compareSpread(candidate, best) < 0)) {
      best = candidate;
    }
    // 最も広い制約集合が安全かつ改善なら、追加試行を避ける。
    if (caps === applied.caps && best === candidate
      && compareHardOutcomes(candidate, baseline) === 0
      && compareSpread(candidate, baseline) < 0) break;
  }
  return best;
}
