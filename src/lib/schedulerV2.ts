import type {
  AppState,
  CapacityReport,
  DeadlineReport,
  EstimateUpdateResult,
  ISODate,
  Material,
  ObjectiveReport,
  ProgressDeficit,
  ScheduleConflict,
  ScheduleGenerationResult,
  ScheduleWarning,
  SchedulerContext,
  StudyTask,
  StudySession,
  TimeRange,
  UnitRange,
  UnscheduledWorkItem,
  ValidationIssue,
} from '../types';
import { addDays, diffDays, hmToMinutes, minutesToHM, weekdayOf } from './date';

interface MinuteRange {
  start: number;
  end: number;
}

interface CalendarDay {
  date: ISODate;
  slots: MinuteRange[];
  budget: number;
  originalBudget: number;
}

interface Assignment {
  sourceType: 'material' | 'review' | 'manual';
  sourceId: string;
  workItemId: string;
  subjectId: string;
  materialId: string | null;
  title: string;
  date: ISODate;
  start: number;
  end: number;
  range?: UnitRange;
  amount: number;
  priority: number;
  dueDate: ISODate | null;
  type: StudyTask['type'];
  template?: StudyTask;
}

const EMPTY_OBJECTIVE: ObjectiveReport = {
  strictDeadlineViolations: 0,
  lockViolations: 0,
  unscheduledStrictMinutes: 0,
  progressDebtMinutes: 0,
  normalOverdueMinutes: 0,
  unscheduledMinutes: 0,
  subjectImbalance: 0,
  timePreferenceViolations: 0,
  taskSwitches: 0,
};

export function mergeMinuteRanges(ranges: MinuteRange[]): MinuteRange[] {
  const sorted = ranges
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.start < range.end)
    .map((range) => ({ ...range }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: MinuteRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push(range);
  }
  return merged;
}

export function mergeTimeRanges(ranges: TimeRange[]): TimeRange[] {
  return mergeMinuteRanges(ranges.map((range) => ({ start: hmToMinutes(range.start), end: hmToMinutes(range.end) })))
    .map((range) => ({ start: minutesToHM(range.start), end: minutesToHM(range.end) }));
}

export function subtractMinuteRanges(windows: MinuteRange[], busy: MinuteRange[]): MinuteRange[] {
  const blocks = mergeMinuteRanges(busy);
  const result: MinuteRange[] = [];
  for (const window of mergeMinuteRanges(windows)) {
    let cursor = window.start;
    for (const block of blocks) {
      if (block.end <= cursor || block.start >= window.end) continue;
      if (block.start > cursor) result.push({ start: cursor, end: Math.min(block.start, window.end) });
      cursor = Math.max(cursor, block.end);
      if (cursor >= window.end) break;
    }
    if (cursor < window.end) result.push({ start: cursor, end: window.end });
  }
  return result;
}

export function normalizeUnitRanges(ranges: UnitRange[], totalUnits?: number): UnitRange[] {
  const sorted = ranges
    .map((range) => ({ start: range.start, end: range.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (sorted.some((range) => !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 1 || range.start > range.end || (totalUnits !== undefined && range.end > totalUnits))) {
    throw new Error('INVALID_UNIT_RANGE');
  }
  const merged: UnitRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end);
    else merged.push(range);
  }
  return merged;
}

export function sumRangeLengths(ranges: UnitRange[]): number {
  return ranges.reduce((sum, range) => sum + range.end - range.start + 1, 0);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function updateMinutesPerUnitEstimate(
  material: Material,
  sessions: StudySession[],
  alpha = 0.2,
): EstimateUpdateResult {
  const raw = sessions
    .filter((session) => session.materialId === material.id && !session.excludedFromEstimate && !session.pausedMinutes && session.minutes >= 1 && session.amountDone > 0)
    .map((session) => session.minutes / session.amountDone)
    .filter((value) => Number.isFinite(value) && value > 0);
  const center = median(raw);
  const mad = median(raw.map((value) => Math.abs(value - center)));
  const valid = raw.filter((value) => value >= center / 4 && value <= center * 4 && (mad === 0 || Math.abs(value - center) <= mad * 3));
  const observed = valid.length > 0 ? median(valid) : null;
  const boundedAlpha = Math.max(0, Math.min(1, alpha));
  const smoothed = observed === null ? null : material.minutesPerUnit * (1 - boundedAlpha) + observed * boundedAlpha;
  const suggested = smoothed === null ? null : Math.max(material.minutesPerUnit * 0.85, Math.min(material.minutesPerUnit * 1.15, smoothed));
  const applied = valid.length >= 3 && material.estimateMode === 'auto' && suggested !== null;
  return {
    previousEstimate: material.minutesPerUnit,
    observedEstimate: observed,
    suggestedEstimate: valid.length >= 3 ? suggested : null,
    appliedEstimate: applied ? suggested! : material.minutesPerUnit,
    sampleCount: valid.length,
    excludedCount: raw.length - valid.length,
    applied,
  };
}

export function remainingUnitRanges(totalUnits: number, completedRanges: UnitRange[]): UnitRange[] {
  const completed = normalizeUnitRanges(completedRanges, totalUnits);
  const remaining: UnitRange[] = [];
  let cursor = 1;
  for (const range of completed) {
    if (cursor < range.start) remaining.push({ start: cursor, end: range.start - 1 });
    cursor = range.end + 1;
  }
  if (cursor <= totalUnits) remaining.push({ start: cursor, end: totalUnits });
  return remaining;
}

function removeClaimedRanges(ranges: UnitRange[], claimed: UnitRange[]): UnitRange[] {
  let result = ranges.map((range) => ({ ...range }));
  for (const claim of claimed) {
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

export function preferredFinishDateFor(material: Material): ISODate {
  if (material.preferredFinishDate) return material.preferredFinishDate;
  const span = Math.max(0, diffDays(material.startDate, material.targetDate));
  if (material.deadlinePolicy === 'flexible') return material.targetDate;
  const ratio = material.deadlinePolicy === 'strict' ? 0.85 : 0.9;
  const minimumLead = material.deadlinePolicy === 'strict' ? 2 : 1;
  const proportional = addDays(material.startDate, Math.floor(span * ratio));
  const leadDate = addDays(material.targetDate, -minimumLead);
  return proportional < material.startDate ? material.startDate : proportional > leadDate ? (leadDate < material.startDate ? material.startDate : leadDate) : proportional;
}

export function dateInTimeZone(date: Date, timeZone: string): ISODate {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function minutesInTimeZone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return (value('hour') % 24) * 60 + value('minute');
}

function issue(targetId: string, field: string, value: unknown, reason: string, suggestion: string): ValidationIssue {
  return { targetId, field, value, reason, suggestion };
}

export function validateStateV2(state: AppState): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  for (const material of state.materials) {
    const total = material.totalUnits ?? material.totalAmount;
    if (!(total > 0)) errors.push(issue(material.id, 'totalUnits', total, '教材総量は0より大きい必要があります', '1以上を指定してください'));
    if (!(material.minutesPerUnit > 0)) errors.push(issue(material.id, 'minutesPerUnit', material.minutesPerUnit, '見積時間は0より大きい必要があります', '1以上を指定してください'));
    if (!((material.unitStep ?? 1) > 0)) errors.push(issue(material.id, 'unitStep', material.unitStep, '単位刻みは0より大きい必要があります', '1以上を指定してください'));
    if (material.targetDate && material.startDate > material.targetDate) errors.push(issue(material.id, 'targetDate', material.targetDate, '期限が開始日より前です', '開始日以降の日付を指定してください'));
    if (material.minimumChunkUnits !== undefined && material.minimumChunkUnits <= 0) errors.push(issue(material.id, 'minimumChunkUnits', material.minimumChunkUnits, '最小チャンクは0より大きい必要があります', '1以上を指定してください'));
    if (material.maximumChunkUnits !== undefined && material.maximumChunkUnits < (material.minimumChunkUnits ?? 1)) errors.push(issue(material.id, 'maximumChunkUnits', material.maximumChunkUnits, '最大チャンクが最小チャンク未満です', '最小チャンク以上にしてください'));
    if (material.maxUnitsPerDay !== undefined && material.maxUnitsPerDay <= 0) errors.push(issue(material.id, 'maxUnitsPerDay', material.maxUnitsPerDay, '1日上限は0より大きい必要があります', '1以上を指定してください'));
    if (material.maxMinutesPerDay !== undefined && material.maxMinutesPerDay <= 0) errors.push(issue(material.id, 'maxMinutesPerDay', material.maxMinutesPerDay, '1日上限は0より大きい必要があります', '1以上を指定してください'));
    try {
      const completed = normalizeUnitRanges(material.completedRanges ?? (material.doneAmount > 0 ? [{ start: 1, end: material.doneAmount }] : []), total);
      if (sumRangeLengths(completed) > total) errors.push(issue(material.id, 'completedRanges', material.completedRanges, '完了量が教材総量を超えています', '完了範囲を修正してください'));
    } catch {
      errors.push(issue(material.id, 'completedRanges', material.completedRanges, '完了範囲が教材総量外または不正です', '1から教材総量までの範囲を指定してください'));
    }
  }
  const settings = state.settings;
  if (settings.maxDailyMinutes < 0) errors.push(issue('settings', 'maxDailyMinutes', settings.maxDailyMinutes, '1日上限は0以上である必要があります', '0以上を指定してください'));
  if (settings.sessionMinMinutes < 5) errors.push(issue('settings', 'sessionMinMinutes', settings.sessionMinMinutes, '最小セッションは5分以上である必要があります', '5以上を指定してください'));
  if (settings.sessionMaxMinutes < settings.sessionMinMinutes) errors.push(issue('settings', 'sessionMaxMinutes', settings.sessionMaxMinutes, '最大セッションが最小セッション未満です', '最小セッション以上にしてください'));
  const validateWindows = (targetId: string, windows: TimeRange[]) => windows.forEach((window, index) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(window.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.end) || window.start >= window.end) {
      errors.push(issue(targetId, `windows.${index}`, window, '時間帯の開始は終了より前である必要があります', '日跨ぎは2つの時間帯へ分けてください'));
    }
  });
  state.availability.forEach((slot) => validateWindows(`availability:${slot.weekday}`, slot.windows));
  state.dayPlans.forEach((plan) => validateWindows(`dayPlan:${plan.date}`, plan.availabilityWindows ?? []));
  state.fixedEvents.forEach((event) => validateWindows(event.id, [{ start: event.start, end: event.end }]));
  return errors;
}

function eventsOn(state: AppState, date: ISODate) {
  const weekday = weekdayOf(date);
  return state.fixedEvents.filter((event) => {
    if (event.date) return event.date === date;
    if (event.weekday !== null && event.weekday !== weekday) return false;
    if (event.startDate && date < event.startDate) return false;
    if (event.endDate && date > event.endDate) return false;
    return event.weekday !== null || Boolean(event.startDate || event.endDate);
  });
}

function buildCalendar(state: AppState, context: SchedulerContext, start: ISODate, end: ISODate): Map<ISODate, CalendarDay> {
  const calendar = new Map<ISODate, CalendarDay>();
  const today = dateInTimeZone(context.now, context.timezone);
  const nowMinutes = minutesInTimeZone(context.now, context.timezone);
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const override = state.dayPlans.find((plan) => plan.date === date);
    const availability = state.availability.find((slot) => slot.weekday === weekdayOf(date));
    const windows = override?.load === 'rest'
      ? []
      : override?.availabilityWindows ?? availability?.windows ?? [];
    let slots = subtractMinuteRanges(
      windows.map((window) => ({ start: hmToMinutes(window.start), end: hmToMinutes(window.end) })),
      eventsOn(state, date).map((event) => ({ start: hmToMinutes(event.start), end: hmToMinutes(event.end) })),
    );
    if (date === today) {
      const roundedNow = Math.ceil(nowMinutes / 5) * 5;
      slots = slots.map((slot) => ({ ...slot, start: Math.max(slot.start, roundedNow) })).filter((slot) => slot.start < slot.end);
    }
    const available = slots.reduce((sum, slot) => sum + slot.end - slot.start, 0);
    const configured = override?.availabilityWindows ? available : availability?.minutes ?? available;
    const factor = override?.load === 'light' ? 0.6 : override?.load === 'heavy' ? 1.2 : 1;
    const budget = Math.max(0, Math.min(available, Math.round(configured * factor), state.settings.maxDailyMinutes));
    calendar.set(date, { date, slots, budget, originalBudget: budget });
  }
  return calendar;
}

function reserve(day: CalendarDay, start: number, end: number): boolean {
  if (end <= start || end - start > day.budget) return false;
  if (!day.slots.some((slot) => start >= slot.start && end <= slot.end)) return false;
  day.slots = subtractMinuteRanges(day.slots, [{ start, end }]);
  day.budget -= end - start;
  return true;
}

function cloneCalendar(calendar: Map<ISODate, CalendarDay>) {
  return new Map([...calendar].map(([date, day]) => [date, { ...day, slots: day.slots.map((slot) => ({ ...slot })) }]));
}

function replaceCalendar(target: Map<ISODate, CalendarDay>, source: Map<ISODate, CalendarDay>) {
  target.clear();
  source.forEach((day, date) => target.set(date, day));
}

function taskRange(task: StudyTask): UnitRange | undefined {
  return task.materialRange ?? (task.rangeStart !== null && task.rangeEnd !== null ? { start: task.rangeStart, end: task.rangeEnd } : undefined);
}

function effectiveLock(task: StudyTask): 'none' | 'date' | 'time' {
  if (task.placementLock) return task.placementLock;
  if (task.generatedBy === 'manual') return task.scheduledStart ? 'time' : 'date';
  return 'none';
}

function materialTotal(material: Material) {
  return material.totalUnits ?? material.totalAmount;
}

function deterministicHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function deterministicTaskId(generationId: string, workItemId: string, date: ISODate, start: string, range?: UnitRange) {
  return `task_${deterministicHash([generationId, workItemId, date, start, range?.start ?? '', range?.end ?? ''].join('|'))}`;
}

function taskFromAssignment(assignment: Assignment, context: SchedulerContext): StudyTask {
  const start = minutesToHM(assignment.start);
  const end = minutesToHM(assignment.end);
  if (assignment.template) {
    return {
      ...assignment.template,
      id: assignment.template.manualScheduling?.splittable
        ? deterministicTaskId(context.generationId, assignment.workItemId, assignment.date, start, assignment.range)
        : assignment.template.id,
      scheduledDate: assignment.date,
      scheduledStart: start,
      scheduledEnd: end,
      estimatedMinutes: assignment.end - assignment.start,
      placementStatus: 'scheduled',
      status: 'planned',
      updatedAt: context.now.toISOString(),
    };
  }
  const rangeLabel = assignment.range
    ? assignment.range.start === assignment.range.end
      ? `${assignment.range.start}`
      : `${assignment.range.start}〜${assignment.range.end}`
    : '';
  return {
    id: deterministicTaskId(context.generationId, assignment.workItemId, assignment.date, start, assignment.range),
    subjectId: assignment.subjectId,
    materialId: assignment.materialId,
    title: assignment.title,
    rangeLabel,
    rangeStart: assignment.range?.start ?? null,
    rangeEnd: assignment.range?.end ?? null,
    amount: assignment.amount,
    estimatedMinutes: assignment.end - assignment.start,
    priority: assignment.priority,
    dueDate: assignment.dueDate,
    type: assignment.type,
    status: 'planned',
    scheduledDate: assignment.date,
    scheduledStart: start,
    scheduledEnd: end,
    generatedBy: 'auto',
    memo: '',
    reviewStage: null,
    createdAt: context.now.toISOString(),
    updatedAt: context.now.toISOString(),
    completedAt: null,
    sourceType: assignment.sourceType,
    sourceId: assignment.sourceId,
    placementStatus: 'scheduled',
    placementLock: 'none',
    materialRange: assignment.range,
  };
}

function placeFixedTasks(state: AppState, calendar: Map<ISODate, CalendarDay>, context: SchedulerContext) {
  const conflicts: ScheduleConflict[] = [];
  const valid: StudyTask[] = [];
  const conflictTasks: StudyTask[] = [];
  const today = dateInTimeZone(context.now, context.timezone);
  const fixed = state.tasks
    .filter((task) => task.status === 'doing' || (task.status === 'planned' && effectiveLock(task) === 'time') || (task.status === 'done' && task.scheduledDate >= today))
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || (a.scheduledStart ?? '').localeCompare(b.scheduledStart ?? '') || a.id.localeCompare(b.id));
  for (const task of fixed) {
    const day = calendar.get(task.scheduledDate);
    const start = task.scheduledStart ? hmToMinutes(task.scheduledStart) : NaN;
    const end = task.scheduledEnd ? hmToMinutes(task.scheduledEnd) : start + task.estimatedMinutes;
    const reason = !day
      ? '固定日時が計画期間外です'
      : task.scheduledDate < today
        ? '過去の未完了固定タスクです'
        : !Number.isFinite(start) || end - start !== task.estimatedMinutes
          ? '固定タスクの時刻と見積時間が一致しません'
          : !reserve(day, start, end)
            ? '固定予定、利用可能時間、日別予算、または別の固定タスクと衝突しています'
            : null;
    if (reason) {
      conflicts.push({ taskId: task.id, code: 'LOCKED_TASK_CONFLICT', message: reason });
      conflictTasks.push({ ...task, placementStatus: 'conflict' });
    } else valid.push({ ...task, placementStatus: 'scheduled', placementLock: effectiveLock(task) === 'none' ? task.placementLock : 'time' });
  }
  return { conflicts, valid, conflictTasks };
}

function findSlot(day: CalendarDay, minutes: number): MinuteRange | null {
  if (minutes > day.budget) return null;
  const slot = day.slots.find((candidate) => candidate.end - candidate.start >= minutes);
  return slot ? { start: slot.start, end: slot.start + minutes } : null;
}

function allocateTask(task: StudyTask, calendar: Map<ISODate, CalendarDay>, start: ISODate, end: ISODate, strictDeadline?: ISODate): Assignment[] | null {
  const scheduling = task.manualScheduling;
  const minimum = Math.max(1, scheduling?.minimumChunkMinutes ?? task.estimatedMinutes);
  const maximum = Math.max(minimum, scheduling?.maximumChunkMinutes ?? task.estimatedMinutes);
  const splittable = scheduling?.splittable ?? false;
  const lock = effectiveLock(task);
  const release = lock === 'date' ? task.scheduledDate : scheduling?.fixedDate ?? start;
  const deadline = lock === 'date' ? task.scheduledDate : strictDeadline ?? scheduling?.deadline ?? task.dueDate ?? end;
  let remaining = task.estimatedMinutes;
  const assignments: Assignment[] = [];
  for (let date = release > start ? release : start; date <= deadline && date <= end && remaining > 0; date = addDays(date, 1)) {
    const day = calendar.get(date);
    if (!day) continue;
    const chunk = splittable ? Math.min(remaining, maximum) : remaining;
    const allowedSmallFinal = chunk === remaining;
    if (chunk < minimum && !allowedSmallFinal) continue;
    const slot = findSlot(day, chunk);
    if (!slot) continue;
    reserve(day, slot.start, slot.end);
    assignments.push({
      sourceType: task.sourceType ?? (task.generatedBy === 'manual' ? 'manual' : 'review'),
      sourceId: task.sourceId ?? task.id,
      workItemId: `task:${task.id}`,
      subjectId: task.subjectId,
      materialId: task.materialId,
      title: task.title,
      date,
      start: slot.start,
      end: slot.end,
      amount: task.amount,
      priority: task.priority,
      dueDate: task.dueDate,
      type: task.type,
      template: task,
    });
    remaining -= chunk;
    if (!splittable) break;
  }
  return remaining === 0 ? assignments : null;
}

function takeUnits(ranges: UnitRange[], requested: number, unitStep: number): UnitRange | null {
  const first = ranges[0];
  if (!first) return null;
  const available = first.end - first.start + 1;
  let units = Math.min(available, requested);
  if (units < available) units = Math.floor(units / unitStep) * unitStep;
  if (units <= 0) return null;
  const range = { start: first.start, end: first.start + units - 1 };
  if (range.end === first.end) ranges.shift();
  else first.start = range.end + 1;
  return range;
}

function allocateMaterial(
  material: Material,
  ranges: UnitRange[],
  calendar: Map<ISODate, CalendarDay>,
  from: ISODate,
  to: ISODate,
  maxUnitsWanted = Number.POSITIVE_INFINITY,
  priority = 0,
  defaultMinimumMinutes = 5,
  defaultMaximumMinutes = 90,
  priorAssignments: Assignment[] = [],
  fixedTasks: StudyTask[] = [],
): Assignment[] {
  const assignments: Assignment[] = [];
  const minutesPerUnit = material.minutesPerUnit;
  const unitStep = material.unitStep ?? 1;
  const minUnits = material.minimumChunkUnits ?? Math.max(unitStep, Math.ceil(defaultMinimumMinutes / minutesPerUnit));
  const maxUnits = material.maximumChunkUnits ?? Math.max(unitStep, Math.floor(defaultMaximumMinutes / minutesPerUnit));
  const totalRemaining = sumRangeLengths(ranges);
  const unitsByDay = new Map<ISODate, number>();
  const minutesByDay = new Map<ISODate, number>();
  for (const assignment of priorAssignments) {
    if (assignment.materialId !== material.id) continue;
    unitsByDay.set(assignment.date, (unitsByDay.get(assignment.date) ?? 0) + assignment.amount);
    minutesByDay.set(assignment.date, (minutesByDay.get(assignment.date) ?? 0) + assignment.end - assignment.start);
  }
  for (const task of fixedTasks) {
    if (task.materialId !== material.id) continue;
    unitsByDay.set(task.scheduledDate, (unitsByDay.get(task.scheduledDate) ?? 0) + task.amount);
    minutesByDay.set(task.scheduledDate, (minutesByDay.get(task.scheduledDate) ?? 0) + task.estimatedMinutes);
  }
  if (material.splittable === false) {
    const minutes = Math.round(totalRemaining * minutesPerUnit);
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const day = calendar.get(date);
      if (!day
        || (material.maxMinutesPerDay !== undefined && minutes + (minutesByDay.get(date) ?? 0) > material.maxMinutesPerDay)
        || (material.maxUnitsPerDay !== undefined && totalRemaining + (unitsByDay.get(date) ?? 0) > material.maxUnitsPerDay)) continue;
      const slot = findSlot(day, minutes);
      if (!slot || ranges.length !== 1) continue;
      const range = takeUnits(ranges, totalRemaining, unitStep);
      if (!range) return [];
      reserve(day, slot.start, slot.end);
      assignments.push(materialAssignment(material, date, slot, range, priority));
      return assignments;
    }
    return [];
  }
  let wanted = Math.min(totalRemaining, maxUnitsWanted);
  for (let date = from; date <= to && wanted > 0 && ranges.length > 0; date = addDays(date, 1)) {
    const day = calendar.get(date);
    if (!day) continue;
    while (wanted > 0 && ranges.length > 0) {
      const unitCap = Math.min(
        maxUnits,
        material.maxUnitsPerDay === undefined ? Number.POSITIVE_INFINITY : material.maxUnitsPerDay - (unitsByDay.get(date) ?? 0),
        material.maxMinutesPerDay === undefined ? Number.POSITIVE_INFINITY : Math.floor((material.maxMinutesPerDay - (minutesByDay.get(date) ?? 0)) / minutesPerUnit),
        Math.floor(day.budget / minutesPerUnit),
      );
      const largestSlot = [...day.slots].sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)[0];
      if (!largestSlot) break;
      const slotUnits = Math.floor((largestSlot.end - largestSlot.start) / minutesPerUnit);
      const remainingAll = sumRangeLengths(ranges);
      let request = Math.min(wanted, remainingAll, unitCap, slotUnits);
      const finalRemainder = request >= remainingAll;
      if (!finalRemainder) request = Math.floor(request / unitStep) * unitStep;
      if (request <= 0 || (request < minUnits && !finalRemainder)) break;
      const snapshot = ranges.map((range) => ({ ...range }));
      const range = takeUnits(ranges, request, unitStep);
      if (!range) break;
      const units = range.end - range.start + 1;
      const minutes = Math.round(units * minutesPerUnit);
      if ((minutes < minUnits * minutesPerUnit && units < remainingAll) || minutes > largestSlot.end - largestSlot.start || minutes > day.budget) {
        ranges.splice(0, ranges.length, ...snapshot);
        break;
      }
      const slot = { start: largestSlot.start, end: largestSlot.start + minutes };
      reserve(day, slot.start, slot.end);
      assignments.push(materialAssignment(material, date, slot, range, priority));
      unitsByDay.set(date, (unitsByDay.get(date) ?? 0) + units);
      minutesByDay.set(date, (minutesByDay.get(date) ?? 0) + minutes);
      wanted -= units;
    }
  }
  return assignments;
}

function materialAssignment(material: Material, date: ISODate, slot: MinuteRange, range: UnitRange, priority: number): Assignment {
  return {
    sourceType: 'material',
    sourceId: material.id,
    workItemId: `material:${material.id}`,
    subjectId: material.subjectId,
    materialId: material.id,
    title: material.name,
    date,
    start: slot.start,
    end: slot.end,
    range,
    amount: range.end - range.start + 1,
    priority,
    dueDate: material.targetDate,
    type: 'new',
  };
}

function eligibleCapacity(calendar: Map<ISODate, CalendarDay>, from: ISODate, to: ISODate) {
  let total = 0;
  for (let date = from; date <= to; date = addDays(date, 1)) total += calendar.get(date)?.budget ?? 0;
  return total;
}

function emptyResult(context: SchedulerContext, start: ISODate, status: ScheduleGenerationResult['status'], errors: ValidationIssue[] = []): ScheduleGenerationResult {
  return {
    status,
    scheduledTasks: [],
    unscheduledWork: [],
    conflicts: [],
    warnings: [],
    progressDeficits: [],
    capacityReport: { horizonStart: start, horizonEnd: start, requiredMinutes: 0, availableMinutes: 0, shortages: [] },
    deadlineReports: [],
    objectiveReport: { ...EMPTY_OBJECTIVE },
    validationErrors: errors,
    generatedAt: context.now.toISOString(),
    generationId: context.generationId,
  };
}

export function generatePlanV2(state: AppState, context: SchedulerContext): ScheduleGenerationResult {
  const today = dateInTimeZone(context.now, context.timezone);
  const validationErrors = validateStateV2(state);
  if (validationErrors.length > 0) return emptyResult(context, today, 'invalidInput', validationErrors);

  const activeMaterials = state.materials.filter((material) => !material.paused && !material.archived && materialTotal(material) > material.doneAmount);
  const strictDates = activeMaterials
    .filter((material) => material.deadlinePolicy === 'strict')
    .map((material) => material.targetDate)
    .sort();
  const latestStrict = strictDates[strictDates.length - 1];
  const taskDeadlineDates = state.tasks
    .filter((task) => task.status === 'planned' && task.manualScheduling?.placementPolicy === 'flexibleBeforeDeadline' && task.manualScheduling.deadline)
    .map((task) => task.manualScheduling!.deadline!)
    .sort();
  const pendingStrictTaskDeadlines = taskDeadlineDates[taskDeadlineDates.length - 1];
  const concreteEnd = addDays(today, Math.max(1, state.settings.taskGenerationHorizonDays ?? 42) - 1);
  const horizonDates = [latestStrict, pendingStrictTaskDeadlines, concreteEnd].filter((date): date is string => Boolean(date)).sort();
  const feasibilityEnd = horizonDates[horizonDates.length - 1] ?? concreteEnd;
  const preferredDates = activeMaterials.filter((material) => material.deadlinePolicy !== 'strict').map(preferredFinishDateFor).sort();
  const latestPreferred = preferredDates[preferredDates.length - 1];
  const targetDates = activeMaterials.map((material) => material.targetDate).sort();
  const latestTarget = targetDates[targetDates.length - 1];
  const fixedTaskDates = state.tasks
    .filter((task) => task.status === 'doing' || task.status === 'done' || (task.status === 'planned' && effectiveLock(task) === 'time'))
    .map((task) => task.scheduledDate)
    .sort();
  const latestFixedTask = fixedTaskDates[fixedTaskDates.length - 1];
  const calendarEnd = [feasibilityEnd, latestPreferred, latestTarget, latestFixedTask].filter((date): date is string => Boolean(date)).sort().pop() ?? feasibilityEnd;
  const calendar = buildCalendar(state, context, today, calendarEnd);
  const totalAvailable = [...calendar.values()].reduce((sum, day) => sum + day.originalBudget, 0);
  const fixed = placeFixedTasks(state, calendar, context);
  const warnings: ScheduleWarning[] = [];
  const unscheduled: UnscheduledWorkItem[] = [];
  const assignments: Assignment[] = [];
  const deadlineReports: DeadlineReport[] = [];

  const claimedByMaterial = new Map<string, UnitRange[]>();
  for (const task of [...fixed.valid, ...state.tasks.filter((item) => item.status === 'done')]) {
    if (!task.materialId) continue;
    const range = taskRange(task);
    if (range) claimedByMaterial.set(task.materialId, [...(claimedByMaterial.get(task.materialId) ?? []), range]);
  }
  const rangesByMaterial = new Map<string, UnitRange[]>();
  for (const material of activeMaterials) {
    const completed = material.completedRanges ?? (material.doneAmount > 0 ? [{ start: 1, end: material.doneAmount }] : []);
    rangesByMaterial.set(material.id, removeClaimedRanges(remainingUnitRanges(materialTotal(material), completed), claimedByMaterial.get(material.id) ?? []));
  }

  const movableTasks = state.tasks
    .filter((task) => {
      if (task.status !== 'planned' || effectiveLock(task) === 'time' || (task.generatedBy === 'auto' && task.type === 'new')) return false;
      if (task.type === 'review') {
        const material = task.materialId ? state.materials.find((item) => item.id === task.materialId) : undefined;
        if (!state.settings.reviewRule.enabled || !material?.reviewEnabled) return false;
      }
      return true;
    })
    .sort((a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') || a.id.localeCompare(b.id));
  for (const task of movableTasks) {
    const strictDeadline = task.manualScheduling?.placementPolicy === 'flexibleBeforeDeadline' ? task.manualScheduling.deadline : undefined;
    const snapshot = cloneCalendar(calendar);
    const placed = allocateTask(task, calendar, today, feasibilityEnd, strictDeadline);
    if (placed) assignments.push(...placed);
    else {
      replaceCalendar(calendar, snapshot);
      unscheduled.push({ workItemId: `task:${task.id}`, sourceId: task.id, minutes: task.estimatedMinutes, reason: task.placementLock === 'date' ? '指定日の連続空き区間へ配置できません' : '期限までの空き区間へ配置できません' });
    }
  }

  const strictMaterials = activeMaterials
    .filter((material) => material.deadlinePolicy === 'strict')
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate) || (b.minimumChunkUnits ?? 1) - (a.minimumChunkUnits ?? 1) || a.id.localeCompare(b.id));
  const searchLimitReached = strictMaterials.length > 0 && context.maxSearchNodes !== undefined && context.maxSearchNodes <= 0;
  for (const material of strictMaterials) {
    const ranges = rangesByMaterial.get(material.id)!;
    const requiredUnits = sumRangeLengths(ranges);
    const requiredMinutes = Math.round(requiredUnits * material.minutesPerUnit);
    const snapshotCalendar = cloneCalendar(calendar);
    const snapshotRanges = ranges.map((range) => ({ ...range }));
    if (searchLimitReached) {
      unscheduled.push({ workItemId: `material:${material.id}`, sourceId: material.id, minutes: requiredMinutes, reason: '探索上限に達したため配置可能性を確定できませんでした' });
      deadlineReports.push({ workItemId: `material:${material.id}`, policy: 'strict', deadline: material.targetDate, feasible: null, scheduledMinutes: 0, requiredMinutes, shortageMinutes: requiredMinutes, overdueDays: 0 });
      continue;
    }
    const placed = allocateMaterial(material, ranges, calendar, material.startDate > today ? material.startDate : today, material.targetDate, requiredUnits, 100, state.settings.sessionMinMinutes, state.settings.sessionMaxMinutes, assignments, fixed.valid);
    const scheduledMinutes = placed.reduce((sum, item) => sum + item.end - item.start, 0);
    const feasible = sumRangeLengths(ranges) === 0;
    if (!feasible) {
      replaceCalendar(calendar, snapshotCalendar);
      ranges.splice(0, ranges.length, ...snapshotRanges);
      unscheduled.push({ workItemId: `material:${material.id}`, sourceId: material.id, minutes: requiredMinutes, reason: '厳守期限までの区間容量またはチャンク条件が不足しています' });
    } else assignments.push(...placed);
    deadlineReports.push({ workItemId: `material:${material.id}`, policy: 'strict', deadline: material.targetDate, feasible, scheduledMinutes: feasible ? scheduledMinutes : 0, requiredMinutes, shortageMinutes: feasible ? 0 : requiredMinutes - scheduledMinutes, overdueDays: 0 });
  }

  const progressDeficits: ProgressDeficit[] = [];
  const flexibleMaterials = activeMaterials
    .filter((material) => material.deadlinePolicy !== 'strict')
    .sort((a, b) => preferredFinishDateFor(a).localeCompare(preferredFinishDateFor(b)) || b.priority - a.priority || a.id.localeCompare(b.id));
  const baselineCapacity = new Map([...calendar].map(([date, day]) => [date, day.budget]));
  const curves = flexibleMaterials.map((material) => {
    const ranges = rangesByMaterial.get(material.id)!;
    const initialRemaining = sumRangeLengths(ranges);
    const finish = preferredFinishDateFor(material);
    const curveStart = material.startDate > today ? material.startDate : today;
    const curveEnd = finish < curveStart ? curveStart : finish;
    let totalCapacity = 0;
    for (let date = curveStart; date <= curveEnd; date = addDays(date, 1)) totalCapacity += baselineCapacity.get(date) ?? 0;
    return { material, ranges, initialRemaining, curveStart, curveEnd, totalCapacity, elapsedCapacity: 0, scheduledUnits: 0, lastTargetUnits: 0 };
  });
  for (const curve of curves) {
    if (curve.initialRemaining > 0 && curve.totalCapacity <= 0) {
      const { material, initialRemaining, curveEnd } = curve;
      warnings.push({ code: 'NO_ELIGIBLE_CAPACITY', targetId: material.id, message: `${material.name}は推奨完了日までに利用可能容量がありません` });
      progressDeficits.push({ materialId: material.id, units: initialRemaining, minutes: Math.round(initialRemaining * material.minutesPerUnit), calculatedForDate: curveEnd });
    }
  }
  for (let date = today; date <= concreteEnd; date = addDays(date, 1)) {
    const candidates = curves
      .filter((curve) => curve.initialRemaining > 0 && curve.totalCapacity > 0 && date >= curve.curveStart && date <= curve.curveEnd && curve.ranges.length > 0)
      .map((curve) => {
        curve.elapsedCapacity += baselineCapacity.get(date) ?? 0;
        curve.lastTargetUnits = Math.min(curve.initialRemaining, Math.ceil(curve.initialRemaining * curve.elapsedCapacity / curve.totalCapacity));
        return { curve, debt: Math.max(0, curve.lastTargetUnits - curve.scheduledUnits) };
      })
      .filter((candidate) => candidate.debt > 0)
      .sort((a, b) => b.debt - a.debt || a.curve.curveEnd.localeCompare(b.curve.curveEnd) || b.curve.material.priority - a.curve.material.priority || a.curve.material.id.localeCompare(b.curve.material.id));
    for (const { curve, debt } of candidates) {
      const before = sumRangeLengths(curve.ranges);
      const chunkUnits = curve.material.maximumChunkUnits ?? Math.max(curve.material.unitStep ?? 1, Math.floor(state.settings.sessionMaxMinutes / curve.material.minutesPerUnit));
      assignments.push(...allocateMaterial(curve.material, curve.ranges, calendar, date, date, Math.min(debt, chunkUnits), 70, state.settings.sessionMinMinutes, state.settings.sessionMaxMinutes, assignments, fixed.valid));
      curve.scheduledUnits += before - sumRangeLengths(curve.ranges);
    }
  }
  for (const curve of curves) {
    if (curve.totalCapacity <= 0) continue;
    const deficitUnits = Math.max(0, curve.lastTargetUnits - curve.scheduledUnits);
    if (deficitUnits > 0) progressDeficits.push({ materialId: curve.material.id, units: deficitUnits, minutes: Math.round(deficitUnits * curve.material.minutesPerUnit), calculatedForDate: curve.curveEnd < concreteEnd ? curve.curveEnd : concreteEnd });
  }

  // 基準進捗後の余剰だけを決定的なスコア順で配分する。
  const scored = flexibleMaterials
    .map((material) => {
      const ranges = rangesByMaterial.get(material.id)!;
      const debt = progressDeficits.find((item) => item.materialId === material.id)?.minutes ?? 0;
      const remainingMinutes = Math.max(1, sumRangeLengths(ranges) * material.minutesPerUnit);
      const pressureCapacity = eligibleCapacity(calendar, today, material.targetDate);
      const originalCapacity = Math.max(1, totalAvailable);
      const score = 0.35 * Math.min(1, debt / remainingMinutes)
        + 0.2 * Math.max(0, Math.min(1, 1 - pressureCapacity / originalCapacity))
        + 0.1 * ((state.subjects.find((subject) => subject.id === material.subjectId)?.importance ?? 3) / 5)
        + 0.08 * ((state.subjects.find((subject) => subject.id === material.subjectId)?.weakness ?? 3) / 5)
        + 0.07 * (material.priority / 5)
        + 0.12 * (material.examRelevance / 5);
      return { material, score };
    })
    .sort((a, b) => b.score - a.score || a.material.id.localeCompare(b.material.id));
  let lastSurplusMaterial: string | null = null;
  for (let date = today; date <= concreteEnd; date = addDays(date, 1)) {
    const existingOnDay = assignments
      .filter((assignment) => assignment.date === date && assignment.materialId)
      .sort((a, b) => a.start - b.start || a.workItemId.localeCompare(b.workItemId));
    lastSurplusMaterial = existingOnDay[existingOnDay.length - 1]?.materialId ?? null;
    while ((calendar.get(date)?.budget ?? 0) >= state.settings.sessionMinMinutes) {
      const pool = scored
        .filter(({ material }) => material.startDate <= date && (rangesByMaterial.get(material.id)?.length ?? 0) > 0)
        .sort((a, b) =>
          Number(a.material.id === lastSurplusMaterial) - Number(b.material.id === lastSurplusMaterial)
          || sumRangeLengths(rangesByMaterial.get(b.material.id) ?? []) - sumRangeLengths(rangesByMaterial.get(a.material.id) ?? [])
          || b.score - a.score
          || a.material.id.localeCompare(b.material.id));
      let placedAny = false;
      for (const { material, score } of pool) {
        const ranges = rangesByMaterial.get(material.id)!;
        const chunkUnits = material.maximumChunkUnits ?? Math.max(material.unitStep ?? 1, Math.floor(state.settings.sessionMaxMinutes / material.minutesPerUnit));
        const placed = allocateMaterial(material, ranges, calendar, date, date, chunkUnits, score * 100, state.settings.sessionMinMinutes, state.settings.sessionMaxMinutes, assignments, fixed.valid);
        if (placed.length === 0) continue;
        assignments.push(...placed);
        lastSurplusMaterial = material.id;
        placedAny = true;
        break;
      }
      if (!placedAny) break;
    }
  }
  for (let index = progressDeficits.length - 1; index >= 0; index -= 1) {
    const deficit = progressDeficits[index];
    const curve = curves.find((item) => item.material.id === deficit.materialId);
    if (!curve || curve.totalCapacity <= 0) continue;
    const scheduledUnits = assignments
      .filter((assignment) => assignment.materialId === deficit.materialId)
      .reduce((sum, assignment) => sum + assignment.amount, 0);
    const units = Math.max(0, curve.lastTargetUnits - scheduledUnits);
    if (units === 0) progressDeficits.splice(index, 1);
    else progressDeficits[index] = { ...deficit, units, minutes: Math.round(units * curve.material.minutesPerUnit) };
  }
  for (const { material } of scored) {
    const ranges = rangesByMaterial.get(material.id)!;
    const remaining = sumRangeLengths(ranges);
    const materialAssignments = assignments.filter((assignment) => assignment.materialId === material.id);
    const overdueAssignments = material.deadlinePolicy === 'normal' ? materialAssignments.filter((assignment) => assignment.date > material.targetDate) : [];
    const overdueMinutes = overdueAssignments.reduce((sum, assignment) => sum + assignment.end - assignment.start, 0);
    const overdueDays = overdueAssignments.reduce((max, assignment) => Math.max(max, diffDays(material.targetDate, assignment.date)), 0);
    const concreteRequirementEnded = material.deadlinePolicy === 'normal'
      ? material.targetDate <= concreteEnd
      : preferredFinishDateFor(material) <= concreteEnd;
    if (remaining > 0 && concreteRequirementEnded) {
      const minutes = Math.round(remaining * material.minutesPerUnit);
      unscheduled.push({ workItemId: `material:${material.id}`, sourceId: material.id, minutes, reason: '具体計画期間内の余剰容量が不足しています' });
    }
    const futureEligibleCapacity = material.deadlinePolicy === 'normal' && material.targetDate > concreteEnd
      ? eligibleCapacity(calendar, addDays(concreteEnd, 1), material.targetDate)
      : 0;
    const normalShortage = material.deadlinePolicy === 'normal'
      ? material.targetDate > concreteEnd
        ? Math.max(0, Math.round(remaining * material.minutesPerUnit) - futureEligibleCapacity)
        : Math.round(remaining * material.minutesPerUnit) + overdueMinutes
      : 0;
    if (normalShortage > 0) warnings.push({ code: 'NORMAL_DEADLINE_RISK', targetId: material.id, minutes: normalShortage, message: `${material.name}は期限を${overdueDays}日超過し、期限時点で${normalShortage}分不足する見込みです` });
    deadlineReports.push({
      workItemId: `material:${material.id}`,
      policy: material.deadlinePolicy,
      deadline: material.targetDate,
      feasible: material.deadlinePolicy === 'flexible' ? null : normalShortage === 0,
      scheduledMinutes: Math.round((initialUnits(material) - remaining) * material.minutesPerUnit),
      requiredMinutes: Math.round(initialUnits(material) * material.minutesPerUnit),
      shortageMinutes: material.deadlinePolicy === 'normal' ? normalShortage : Math.round(remaining * material.minutesPerUnit),
      overdueDays,
    });
  }

  const generated = assignments
    .filter((assignment) => assignment.date <= concreteEnd)
    .map((assignment) => taskFromAssignment(assignment, context));
  const scheduledTasks = [...fixed.valid, ...generated].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || (a.scheduledStart ?? '').localeCompare(b.scheduledStart ?? '') || a.id.localeCompare(b.id));
  const strictUnscheduled = deadlineReports.filter((report) => report.policy === 'strict' && report.feasible === false).reduce((sum, report) => sum + report.shortageMinutes, 0);
  const strictIndeterminate = deadlineReports.filter((report) => report.policy === 'strict' && report.feasible === null).reduce((sum, report) => sum + report.shortageMinutes, 0);
  const requiredMinutes = activeMaterials.reduce((sum, material) => sum + initialUnits(material) * material.minutesPerUnit, 0) + movableTasks.reduce((sum, task) => sum + task.estimatedMinutes, 0);
  const shortage = Math.max(0, strictUnscheduled);
  const capacityReport: CapacityReport = {
    horizonStart: today,
    horizonEnd: calendarEnd,
    requiredMinutes: Math.round(requiredMinutes),
    availableMinutes: totalAvailable,
    shortages: shortage > 0 ? [{
      periodStart: today,
      periodEnd: feasibilityEnd,
      requiredMinutes: Math.round(requiredMinutes),
      availableMinutes: totalAvailable,
      shortageMinutes: shortage,
      affectedWorkItemIds: deadlineReports.filter((report) => report.policy === 'strict' && !report.feasible).map((report) => report.workItemId),
      suggestedActions: [
        { type: 'increaseDailyMinutes', value: Math.ceil(shortage / Math.max(1, diffDays(today, feasibilityEnd) + 1)), label: `1日あたり${Math.ceil(shortage / Math.max(1, diffDays(today, feasibilityEnd) + 1))}分増やす` },
        { type: 'allowSplit', label: '分割不可の作業を分割可能にする' },
        { type: 'extendDeadline', label: '厳守期限を延長する' },
      ],
    }] : [],
  };
  const objectiveReport: ObjectiveReport = {
    ...EMPTY_OBJECTIVE,
    lockViolations: fixed.conflicts.length,
    unscheduledStrictMinutes: strictUnscheduled + strictIndeterminate,
    progressDebtMinutes: progressDeficits.reduce((sum, deficit) => sum + deficit.minutes, 0),
    normalOverdueMinutes: deadlineReports.filter((report) => report.policy === 'normal').reduce((sum, report) => sum + report.shortageMinutes, 0),
    unscheduledMinutes: unscheduled.reduce((sum, item) => sum + item.minutes, 0),
    taskSwitches: countSwitches(scheduledTasks),
  };
  const result: ScheduleGenerationResult = {
    status: fixed.conflicts.length > 0 ? 'conflict' : strictIndeterminate > 0 ? 'indeterminate' : strictUnscheduled > 0 ? 'infeasible' : unscheduled.length > 0 ? 'partial' : 'success',
    scheduledTasks,
    unscheduledWork: unscheduled,
    conflicts: fixed.conflicts,
    warnings,
    progressDeficits,
    capacityReport,
    deadlineReports,
    objectiveReport,
    generatedAt: context.now.toISOString(),
    generationId: context.generationId,
  };
  const outputErrors = validateGeneratedScheduleV2(state, result, context);
  if (outputErrors.length > 0) return { ...emptyResult(context, today, 'invalidInput', outputErrors), warnings: [{ code: 'INTERNAL_VALIDATION_FAILURE', message: '生成後検証に失敗したため、新しい計画を保存しません' }] };
  return result;
}

function initialUnits(material: Material) {
  const completed = material.completedRanges ?? (material.doneAmount > 0 ? [{ start: 1, end: material.doneAmount }] : []);
  return materialTotal(material) - sumRangeLengths(normalizeUnitRanges(completed, materialTotal(material)));
}

function countSwitches(tasks: StudyTask[]) {
  let switches = 0;
  let previous: StudyTask | undefined;
  for (const task of tasks) {
    if (previous && previous.scheduledDate === task.scheduledDate && previous.materialId !== task.materialId) switches += 1;
    previous = task;
  }
  return switches;
}

export function validateGeneratedScheduleV2(state: AppState, result: ScheduleGenerationResult, context: SchedulerContext): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const today = dateInTimeZone(context.now, context.timezone);
  const calendar = buildCalendar(state, context, today, result.capacityReport.horizonEnd);
  const byDate = new Map<ISODate, StudyTask[]>();
  const ids = new Set<string>();
  const rangesByMaterial = new Map<string, UnitRange[]>();
  const materialDayUsage = new Map<string, { units: number; minutes: number }>();
  for (const task of result.scheduledTasks) {
    if (ids.has(task.id)) errors.push(issue(task.id, 'id', task.id, 'タスクIDが重複しています', '決定的ID入力を確認してください'));
    ids.add(task.id);
    if (task.placementStatus !== 'scheduled' || !task.scheduledStart || !task.scheduledEnd) errors.push(issue(task.id, 'placementStatus', task.placementStatus, '配置済みタスクに時刻がありません', '未配置として返してください'));
    if (!task.scheduledStart || !task.scheduledEnd) continue;
    const start = hmToMinutes(task.scheduledStart);
    const end = hmToMinutes(task.scheduledEnd);
    if (end - start !== task.estimatedMinutes) errors.push(issue(task.id, 'estimatedMinutes', task.estimatedMinutes, '時刻差と見積時間が一致しません', '終了時刻を再計算してください'));
    const day = calendar.get(task.scheduledDate);
    if (!day || !day.slots.some((slot) => start >= slot.start && end <= slot.end)) errors.push(issue(task.id, 'scheduledStart', task.scheduledStart, '利用可能時間または現在時刻より前へ配置されています', '空き区間内へ配置してください'));
    const material = task.materialId ? state.materials.find((item) => item.id === task.materialId) : undefined;
    if (material) {
      if (task.scheduledDate < material.startDate) errors.push(issue(task.id, 'scheduledDate', task.scheduledDate, '教材開始日前です', '開始日以降へ配置してください'));
      if (material.deadlinePolicy === 'strict' && task.scheduledDate > material.targetDate) errors.push(issue(task.id, 'scheduledDate', task.scheduledDate, '厳守期限後です', '期限以前へ配置してください'));
      if (material.paused || material.archived) errors.push(issue(task.id, 'materialId', material.id, '停止中またはアーカイブ済み教材です', '配置対象から除外してください'));
      const range = taskRange(task);
      if (range) {
        rangesByMaterial.set(material.id, [...(rangesByMaterial.get(material.id) ?? []), range]);
        const completed = normalizeUnitRanges(material.completedRanges ?? (material.doneAmount > 0 ? [{ start: 1, end: material.doneAmount }] : []), materialTotal(material));
        if (completed.some((item) => range.start <= item.end && range.end >= item.start)) errors.push(issue(task.id, 'materialRange', range, '完了済み範囲と重複しています', '未完了範囲を割り当ててください'));
        const units = range.end - range.start + 1;
        const finalRemainder = range.end === materialTotal(material);
        if (units % (material.unitStep ?? 1) !== 0 && !finalRemainder) errors.push(issue(task.id, 'materialRange', range, 'unitStepに一致しません', `${material.unitStep ?? 1}単位刻みへ丸めてください`));
        if (material.minimumChunkUnits !== undefined && units < material.minimumChunkUnits && !finalRemainder) errors.push(issue(task.id, 'materialRange', range, '最小チャンク未満です', '最終残量以外は最小チャンク以上にしてください'));
        if (material.maximumChunkUnits !== undefined && units > material.maximumChunkUnits && !(units === 1 && task.estimatedMinutes > state.settings.sessionMaxMinutes)) errors.push(issue(task.id, 'materialRange', range, '最大チャンクを超えています', 'タスクを分割してください'));
        const key = `${material.id}|${task.scheduledDate}`;
        const usage = materialDayUsage.get(key) ?? { units: 0, minutes: 0 };
        usage.units += units;
        usage.minutes += task.estimatedMinutes;
        materialDayUsage.set(key, usage);
      }
    }
    byDate.set(task.scheduledDate, [...(byDate.get(task.scheduledDate) ?? []), task]);
  }
  for (const [date, tasks] of byDate) {
    const sorted = tasks.sort((a, b) => a.scheduledStart!.localeCompare(b.scheduledStart!));
    for (let i = 1; i < sorted.length; i += 1) if (sorted[i - 1].scheduledEnd! > sorted[i].scheduledStart!) errors.push(issue(sorted[i].id, 'scheduledStart', sorted[i].scheduledStart, 'タスク同士が重複しています', '別の空き区間へ配置してください'));
    const budget = calendar.get(date)?.originalBudget ?? 0;
    const used = tasks.reduce((sum, task) => sum + task.estimatedMinutes, 0);
    if (used > budget) errors.push(issue(date, 'dailyBudget', used, '日別予算を超えています', `${budget}分以内へ減らしてください`));
  }
  for (const [materialId, ranges] of rangesByMaterial) {
    const sorted = ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 1; i < sorted.length; i += 1) if (sorted[i].start <= sorted[i - 1].end) errors.push(issue(materialId, 'materialRange', sorted[i], '教材範囲がタスク間で重複しています', '未使用範囲を割り当ててください'));
  }
  for (const [key, usage] of materialDayUsage) {
    const [materialId, date] = key.split('|');
    const material = state.materials.find((item) => item.id === materialId);
    if (!material) continue;
    if (material.maxUnitsPerDay !== undefined && usage.units > material.maxUnitsPerDay) errors.push(issue(materialId, `maxUnitsPerDay:${date}`, usage.units, '教材の1日単位上限を超えています', `${material.maxUnitsPerDay}以下へ減らしてください`));
    if (material.maxMinutesPerDay !== undefined && usage.minutes > material.maxMinutesPerDay) errors.push(issue(materialId, `maxMinutesPerDay:${date}`, usage.minutes, '教材の1日時間上限を超えています', `${material.maxMinutesPerDay}分以下へ減らしてください`));
  }
  return errors;
}
