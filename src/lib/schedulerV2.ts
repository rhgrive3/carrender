import type {
  AppState,
  CapacityReport,
  ConflictCode,
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
import type { DayAllocation, SolverDayInput, SolverItem } from './strictSolver';
import { compareItemsForSearch, countItemPlacements, minutesForUnits, solveStrict } from './strictSolver';

interface MinuteRange {
  start: number;
  end: number;
}

interface CalendarDay {
  date: ISODate;
  slots: MinuteRange[];
  budget: number;
  originalBudget: number;
  /** 利用可能時間帯(固定予定を引く前・現在時刻で切る前) */
  windows: MinuteRange[];
  /** 固定予定の時間帯 */
  events: MinuteRange[];
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
  sameMaterialStreak: 0,
};

const CONFLICT_MESSAGES: Record<ConflictCode, string> = {
  OUTSIDE_AVAILABILITY: '利用可能時間外に固定されています',
  OVERLAPS_FIXED_EVENT: '固定予定と重なっています',
  OVERLAPS_LOCKED_TASK: '別の固定タスクと重なっています',
  EXCEEDS_DAILY_BUDGET: '日別学習予算を超過しています',
  PAST_TIME: '固定時刻が現在時刻より前です',
  INVALID_TIME_RANGE: '固定タスクの時刻指定が不正です',
  DURATION_MISMATCH: '固定タスクの時刻と見積時間が一致しません',
  OUTSIDE_HORIZON: '固定日時が計画期間外です',
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
    const windowRanges = mergeMinuteRanges(windows.map((window) => ({ start: hmToMinutes(window.start), end: hmToMinutes(window.end) })));
    const eventRanges = mergeMinuteRanges(eventsOn(state, date).map((event) => ({ start: hmToMinutes(event.start), end: hmToMinutes(event.end) })));
    let slots = subtractMinuteRanges(windowRanges, eventRanges);
    if (date === today) {
      const roundedNow = Math.ceil(nowMinutes / 5) * 5;
      slots = slots.map((slot) => ({ ...slot, start: Math.max(slot.start, roundedNow) })).filter((slot) => slot.start < slot.end);
    }
    const available = slots.reduce((sum, slot) => sum + slot.end - slot.start, 0);
    const configured = override?.availabilityWindows ? available : availability?.minutes ?? available;
    const factor = override?.load === 'light' ? 0.6 : override?.load === 'heavy' ? 1.2 : 1;
    const budget = Math.max(0, Math.min(available, Math.round(configured * factor), state.settings.maxDailyMinutes));
    calendar.set(date, { date, slots, budget, originalBudget: budget, windows: windowRanges, events: eventRanges });
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

/**
 * タスクの配置ロック。旧データの推測はマイグレーション(normalizeState)で
 * 明示的なplacementLockに変換済みなので、実行時は明示値だけを見る。
 */
function effectiveLock(task: StudyTask): 'none' | 'date' | 'time' {
  if (task.manualScheduling?.placementPolicy === 'fixedTime') return 'time';
  return task.placementLock ?? 'none';
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

/**
 * 時刻固定タスク(doing / placementLock time / fixedTime)だけをカレンダーへ固定する。
 * - 完了済みタスクは履歴であり、未来の空き時間を予約しない。
 * - 衝突理由はConflictCodeで分離して返す。
 * - 日別予算の超過だけならconflictにせず、警告を出して自動タスク側を減らす。
 */
function placeFixedTasks(state: AppState, calendar: Map<ISODate, CalendarDay>, context: SchedulerContext) {
  const conflicts: ScheduleConflict[] = [];
  const warnings: ScheduleWarning[] = [];
  const valid: StudyTask[] = [];
  const conflictTasks: StudyTask[] = [];
  const today = dateInTimeZone(context.now, context.timezone);
  const roundedNow = Math.ceil(minutesInTimeZone(context.now, context.timezone) / 5) * 5;
  const fixed = state.tasks
    .filter((task) => (task.status === 'doing' || (task.status === 'planned' && effectiveLock(task) === 'time')) && task.scheduledDate >= today)
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || (a.scheduledStart ?? '').localeCompare(b.scheduledStart ?? '') || a.id.localeCompare(b.id));
  for (const task of fixed) {
    const day = calendar.get(task.scheduledDate);
    const start = task.scheduledStart ? hmToMinutes(task.scheduledStart) : NaN;
    const end = task.scheduledEnd ? hmToMinutes(task.scheduledEnd) : (Number.isFinite(start) ? start + task.estimatedMinutes : NaN);
    if (task.status === 'doing') {
      // 実行中タスクは一時的整合性のため衝突にせず、重なる分だけベストエフォートで確保する
      if (day && Number.isFinite(start) && end > start) {
        const overlap = day.slots.reduce((sum, slot) => sum + Math.max(0, Math.min(end, slot.end) - Math.max(start, slot.start)), 0);
        day.slots = subtractMinuteRanges(day.slots, [{ start, end }]);
        day.budget = Math.max(0, day.budget - overlap);
      }
      valid.push({ ...task, placementStatus: 'scheduled' });
      continue;
    }
    const code: ConflictCode | null = !day
      ? 'OUTSIDE_HORIZON'
      : !Number.isFinite(start) || !(end > start)
        ? 'INVALID_TIME_RANGE'
        : end - start !== task.estimatedMinutes
          ? 'DURATION_MISMATCH'
          : task.scheduledDate === today && start < roundedNow
            ? 'PAST_TIME'
            : !day.windows.some((window) => start >= window.start && end <= window.end)
              ? 'OUTSIDE_AVAILABILITY'
              : day.events.some((event) => start < event.end && end > event.start)
                ? 'OVERLAPS_FIXED_EVENT'
                : !day.slots.some((slot) => start >= slot.start && end <= slot.end)
                  ? 'OVERLAPS_LOCKED_TASK'
                  : null;
    if (code) {
      conflicts.push({ taskId: task.id, code, message: CONFLICT_MESSAGES[code] });
      conflictTasks.push({ ...task, placementStatus: 'conflict' });
      continue;
    }
    const minutes = end - start;
    if (minutes > day!.budget) {
      warnings.push({
        code: 'EXCEEDS_DAILY_BUDGET',
        targetId: task.id,
        minutes: minutes - day!.budget,
        message: `「${task.title}」が${task.scheduledDate}の学習予算を${minutes - day!.budget}分超過します。固定タスクを優先し、自動タスクを減らします`,
      });
    }
    day!.slots = subtractMinuteRanges(day!.slots, [{ start, end }]);
    day!.budget = Math.max(0, day!.budget - minutes);
    valid.push({ ...task, placementStatus: 'scheduled', placementLock: 'time' });
  }
  return { conflicts, warnings, valid, conflictTasks };
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
    assignments.push(taskAssignment(task, date, slot));
    remaining -= chunk;
    if (!splittable) break;
  }
  return remaining === 0 ? assignments : null;
}

function taskAssignment(task: StudyTask, date: ISODate, slot: MinuteRange): Assignment {
  return {
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
  };
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

/**
 * ObjectiveReportの辞書式比較。上位目的を下位の重み付き合計で逆転させない。
 * 負ならaが良い。
 */
export function compareObjectives(a: ObjectiveReport, b: ObjectiveReport): number {
  const keys: (keyof ObjectiveReport)[] = [
    'strictDeadlineViolations',
    'lockViolations',
    'unscheduledStrictMinutes',
    'progressDebtMinutes',
    'normalOverdueMinutes',
    'unscheduledMinutes',
    'subjectImbalance',
    'timePreferenceViolations',
    'taskSwitches',
    'sameMaterialStreak',
  ];
  for (const key of keys) {
    const diff = (a[key] ?? 0) - (b[key] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
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

// ============================================================
// strict作業(教材+手動タスク)のグローバル配置
// ============================================================

interface StrictWork {
  workItemId: string;
  sourceId: string;
  material?: Material;
  task?: StudyTask;
  deadline: ISODate;
  requiredMinutes: number;
  solverItem: SolverItem;
  verdict: 'feasible' | 'infeasible' | 'indeterminate';
  slippedMinutes: number;
}

interface ReservationEntry {
  units: number;
  minutes: number;
}

function materialSolverItem(material: Material, requiredUnits: number, today: ISODate, sessionMin: number, sessionMax: number): SolverItem {
  const mpu = material.minutesPerUnit;
  const step = material.unitStep ?? 1;
  const minChunkUnits = material.minimumChunkUnits ?? Math.max(step, Math.ceil(sessionMin / mpu));
  const maxChunkUnits = Math.max(minChunkUnits, material.maximumChunkUnits ?? Math.max(step, Math.floor(sessionMax / mpu)));
  return {
    id: `material:${material.id}`,
    release: material.startDate > today ? material.startDate : today,
    deadline: material.targetDate,
    requiredUnits,
    minutesPerUnit: mpu,
    unitStep: step,
    minChunkUnits,
    maxChunkUnits,
    splittable: material.splittable !== false,
    maxUnitsPerDay: material.maxUnitsPerDay,
    maxMinutesPerDay: material.maxMinutesPerDay,
  };
}

function taskSolverItem(task: StudyTask, today: ISODate): SolverItem {
  const scheduling = task.manualScheduling;
  const splittable = scheduling?.splittable ?? false;
  const minimum = Math.max(1, scheduling?.minimumChunkMinutes ?? task.estimatedMinutes);
  const maximum = Math.max(minimum, scheduling?.maximumChunkMinutes ?? task.estimatedMinutes);
  return {
    id: `task:${task.id}`,
    release: today,
    deadline: scheduling!.deadline!,
    requiredUnits: task.estimatedMinutes,
    minutesPerUnit: 1,
    unitStep: 1,
    minChunkUnits: splittable ? minimum : task.estimatedMinutes,
    maxChunkUnits: splittable ? maximum : task.estimatedMinutes,
    splittable,
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
  const lockedTaskDates = state.tasks
    .filter((task) => task.status === 'doing' || (task.status === 'planned' && effectiveLock(task) !== 'none'))
    .map((task) => task.scheduledDate)
    .sort();
  const latestLockedTask = lockedTaskDates[lockedTaskDates.length - 1];
  const calendarEnd = [feasibilityEnd, latestPreferred, latestTarget, latestLockedTask].filter((date): date is string => Boolean(date)).sort().pop() ?? feasibilityEnd;
  const calendar = buildCalendar(state, context, today, calendarEnd);
  const totalAvailable = [...calendar.values()].reduce((sum, day) => sum + day.originalBudget, 0);
  const fixed = placeFixedTasks(state, calendar, context);
  const warnings: ScheduleWarning[] = [...fixed.warnings];
  const unscheduled: UnscheduledWorkItem[] = [];
  const assignments: Assignment[] = [];
  const deadlineReports: DeadlineReport[] = [];
  const sessionMin = state.settings.sessionMinMinutes;
  const sessionMax = state.settings.sessionMaxMinutes;

  // ---------- 教材範囲の請求(完了済み・固定・日付固定タスクが担当する単位を除外) ----------
  const dateLockedTasks = state.tasks
    .filter((task) => task.status === 'planned' && effectiveLock(task) === 'date' && task.scheduledDate >= today)
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.id.localeCompare(b.id));
  const claimedByMaterial = new Map<string, UnitRange[]>();
  for (const task of [...fixed.valid, ...dateLockedTasks, ...state.tasks.filter((item) => item.status === 'done')]) {
    if (!task.materialId) continue;
    const range = taskRange(task);
    if (range) claimedByMaterial.set(task.materialId, [...(claimedByMaterial.get(task.materialId) ?? []), range]);
  }
  const rangesByMaterial = new Map<string, UnitRange[]>();
  for (const material of activeMaterials) {
    const completed = material.completedRanges ?? (material.doneAmount > 0 ? [{ start: 1, end: material.doneAmount }] : []);
    rangesByMaterial.set(material.id, removeClaimedRanges(remainingUnitRanges(materialTotal(material), completed), claimedByMaterial.get(material.id) ?? []));
  }

  // ---------- 日付固定タスク: 指定日内の別時刻へ配置(時刻固定衝突にしない) ----------
  for (const task of dateLockedTasks) {
    const snapshot = cloneCalendar(calendar);
    const placed = allocateTask(task, calendar, today, calendarEnd);
    if (placed) assignments.push(...placed);
    else {
      replaceCalendar(calendar, snapshot);
      unscheduled.push({ workItemId: `task:${task.id}`, sourceId: task.id, minutes: task.estimatedMinutes, reason: '指定日の空き時間が不足しています' });
    }
  }

  // ---------- strict作業のグローバル実行可能性判定(第1段階) ----------
  const strictTasks = state.tasks.filter((task) =>
    task.status === 'planned'
    && effectiveLock(task) === 'none'
    && task.manualScheduling?.placementPolicy === 'flexibleBeforeDeadline'
    && Boolean(task.manualScheduling.deadline));
  const strictWorks: StrictWork[] = [];
  for (const material of activeMaterials.filter((item) => item.deadlinePolicy === 'strict')) {
    const requiredUnits = sumRangeLengths(rangesByMaterial.get(material.id) ?? []);
    if (requiredUnits <= 0) continue;
    strictWorks.push({
      workItemId: `material:${material.id}`,
      sourceId: material.id,
      material,
      deadline: material.targetDate,
      requiredMinutes: minutesForUnits(material.minutesPerUnit, requiredUnits),
      solverItem: materialSolverItem(material, requiredUnits, today, sessionMin, sessionMax),
      verdict: 'infeasible',
      slippedMinutes: 0,
    });
  }
  for (const task of strictTasks) {
    strictWorks.push({
      workItemId: `task:${task.id}`,
      sourceId: task.id,
      task,
      deadline: task.manualScheduling!.deadline!,
      requiredMinutes: task.estimatedMinutes,
      solverItem: taskSolverItem(task, today),
      verdict: 'infeasible',
      slippedMinutes: 0,
    });
  }

  const solverDays = (): SolverDayInput[] => [...calendar.values()]
    .filter((day) => day.date >= today && day.date <= feasibilityEnd)
    .map((day) => ({ date: day.date, slots: day.slots.map((slot) => ({ ...slot })), budget: day.budget }));

  // 最低予約量L: work.workItemId → 日付 → {units, minutes}
  const reservations = new Map<string, Map<ISODate, ReservationEntry>>();
  const reserveByDay = new Map<ISODate, number>();
  const applyReserve = (date: ISODate, minutes: number) => {
    const day = calendar.get(date);
    if (day) day.budget -= minutes;
    reserveByDay.set(date, (reserveByDay.get(date) ?? 0) + minutes);
  };
  const releaseReserve = (date: ISODate, minutes: number) => {
    const day = calendar.get(date);
    if (day) day.budget += minutes;
    reserveByDay.set(date, (reserveByDay.get(date) ?? 0) - minutes);
  };

  if (strictWorks.length > 0) {
    const nodeLimit = context.maxSearchNodes ?? 20000;
    const msLimit = context.maxSearchMilliseconds ?? 400;
    const searchDeadline = Date.now() + msLimit;
    let remainingNodes = nodeLimit;
    const runSolve = (items: SolverItem[]) => {
      const result = solveStrict(items, solverDays(), {
        maxNodes: Math.max(0, remainingNodes),
        maxMs: Math.max(0, searchDeadline - Date.now()),
        preferLate: true,
      });
      remainingNodes -= result.nodes;
      return result;
    };
    const baseDays = solverDays();
    const ordered = [...strictWorks].sort((a, b) =>
      countItemPlacements(a.solverItem, baseDays) - countItemPlacements(b.solverItem, baseDays)
      || compareItemsForSearch(a.solverItem, b.solverItem));
    const full = runSolve(ordered.map((work) => work.solverItem));
    let finalAllocations: Map<string, DayAllocation[]>;
    if (full.status === 'feasible') {
      for (const work of strictWorks) work.verdict = 'feasible';
      finalAllocations = full.allocations;
    } else if (full.status === 'indeterminate') {
      for (const work of strictWorks) work.verdict = 'indeterminate';
      finalAllocations = new Map();
    } else {
      // 全体では不可能: 実行可能な部分集合を2通りの順序で構築し、辞書式目的で良い方を採る
      const buildSubset = (order: StrictWork[]) => {
        const accepted: StrictWork[] = [];
        const verdicts = new Map<string, StrictWork['verdict']>();
        let allocations = new Map<string, DayAllocation[]>();
        for (const work of order) {
          if (remainingNodes <= 0 || Date.now() >= searchDeadline) {
            verdicts.set(work.workItemId, 'indeterminate');
            continue;
          }
          const result = runSolve([...accepted.map((item) => item.solverItem), work.solverItem]);
          if (result.status === 'feasible') {
            accepted.push(work);
            allocations = result.allocations;
            verdicts.set(work.workItemId, 'feasible');
          } else {
            verdicts.set(work.workItemId, result.status);
          }
        }
        const violations = [...verdicts.values()].filter((verdict) => verdict === 'infeasible').length;
        const shortage = order
          .filter((work) => verdicts.get(work.workItemId) !== 'feasible')
          .reduce((sum, work) => sum + work.requiredMinutes, 0);
        return { verdicts, allocations, violations, shortage };
      };
      const subsetA = buildSubset(ordered);
      const subsetB = buildSubset([...strictWorks].sort((a, b) => b.requiredMinutes - a.requiredMinutes || a.workItemId.localeCompare(b.workItemId)));
      const toObjective = (subset: { violations: number; shortage: number }): ObjectiveReport => ({
        ...EMPTY_OBJECTIVE,
        strictDeadlineViolations: subset.violations,
        unscheduledStrictMinutes: subset.shortage,
      });
      const chosen = compareObjectives(toObjective(subsetA), toObjective(subsetB)) <= 0 ? subsetA : subsetB;
      for (const work of strictWorks) work.verdict = chosen.verdicts.get(work.workItemId) ?? 'indeterminate';
      finalAllocations = chosen.allocations;
    }
    // 最低予約量Lをカレンダー予算へ反映(具体タスク化は日次ループで行う)
    for (const work of strictWorks) {
      if (work.verdict !== 'feasible') continue;
      const allocations = finalAllocations.get(work.solverItem.id) ?? [];
      const byDate = new Map<ISODate, ReservationEntry>();
      for (const allocation of allocations) {
        const entry = byDate.get(allocation.date) ?? { units: 0, minutes: 0 };
        entry.units += allocation.units;
        entry.minutes += allocation.minutes;
        byDate.set(allocation.date, entry);
        applyReserve(allocation.date, allocation.minutes);
      }
      reservations.set(work.workItemId, byDate);
    }
  }

  const trimReservation = (work: StrictWork, unitsToTrim: number) => {
    const entries = reservations.get(work.workItemId);
    if (!entries || unitsToTrim <= 0) return;
    const dates = [...entries.keys()].sort().reverse();
    let left = unitsToTrim;
    for (const date of dates) {
      if (left <= 0) break;
      const entry = entries.get(date)!;
      const take = Math.min(entry.units, left);
      const newUnits = entry.units - take;
      const newMinutes = newUnits <= 0 ? 0 : minutesForUnits(work.solverItem.minutesPerUnit, newUnits);
      releaseReserve(date, entry.minutes - newMinutes);
      if (newUnits <= 0) entries.delete(date);
      else entries.set(date, { units: newUnits, minutes: newMinutes });
      left -= take;
    }
  };

  const carryReservation = (work: StrictWork, fromDate: ISODate, units: number) => {
    const minutes = minutesForUnits(work.solverItem.minutesPerUnit, units);
    for (let date = addDays(fromDate, 1); date <= work.deadline; date = addDays(date, 1)) {
      if (!calendar.has(date)) continue;
      const entries = reservations.get(work.workItemId)!;
      const entry = entries.get(date) ?? { units: 0, minutes: 0 };
      entry.units += units;
      entry.minutes += minutes;
      entries.set(date, entry);
      applyReserve(date, minutes);
      return;
    }
    work.slippedMinutes += minutes;
    warnings.push({
      code: 'STRICT_PLACEMENT_SLIP',
      targetId: work.sourceId,
      minutes,
      message: `厳守作業の予約${minutes}分を区間の断片化により期限内へ配置できませんでした`,
    });
  };

  // 実行可能と判定されたstrict手動タスクは早期に前詰め配置を試みる(不可なら予約日に配置)
  for (const work of strictWorks) {
    if (!work.task || work.verdict !== 'feasible') continue;
    const entries = reservations.get(work.workItemId)!;
    for (const [date, entry] of entries) releaseReserve(date, entry.minutes);
    const snapshot = cloneCalendar(calendar);
    const placed = allocateTask(work.task, calendar, today, feasibilityEnd, work.deadline);
    if (placed) {
      assignments.push(...placed);
      reservations.delete(work.workItemId);
    } else {
      replaceCalendar(calendar, snapshot);
      for (const [date, entry] of entries) applyReserve(date, entry.minutes);
    }
  }

  // ---------- 復習・非固定手動タスク(strict予約後の残り容量へ) ----------
  const strictTaskIds = new Set(strictTasks.map((task) => task.id));
  const movableTasks = state.tasks
    .filter((task) => {
      if (task.status !== 'planned' || effectiveLock(task) !== 'none' || strictTaskIds.has(task.id)) return false;
      if (task.generatedBy === 'auto' && task.type === 'new') return false;
      if (task.type === 'review') {
        const material = task.materialId ? state.materials.find((item) => item.id === task.materialId) : undefined;
        if (!state.settings.reviewRule.enabled || !material?.reviewEnabled) return false;
      }
      return true;
    })
    .sort((a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') || a.id.localeCompare(b.id));
  for (const task of movableTasks) {
    const snapshot = cloneCalendar(calendar);
    const placed = allocateTask(task, calendar, today, feasibilityEnd);
    if (placed) assignments.push(...placed);
    else {
      replaceCalendar(calendar, snapshot);
      unscheduled.push({ workItemId: `task:${task.id}`, sourceId: task.id, minutes: task.estimatedMinutes, reason: '期限までの空き区間へ配置できません' });
    }
  }

  // ---------- 進捗曲線(第2段階): 日別容量を教材間で配分した基準容量で累積目標を作る ----------
  const strictWorkByMaterial = new Map<string, StrictWork>();
  for (const work of strictWorks) if (work.material) strictWorkByMaterial.set(work.material.id, work);
  const strictInfeasibleMaterials = new Set(
    strictWorks.filter((work) => work.material && work.verdict === 'infeasible').map((work) => work.material!.id),
  );
  const curveMaterials = activeMaterials.filter((material) =>
    (rangesByMaterial.get(material.id)?.length ?? 0) > 0 && !strictInfeasibleMaterials.has(material.id));
  const dates: ISODate[] = [];
  for (let date = today; date <= calendarEnd; date = addDays(date, 1)) dates.push(date);
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const capBase = dates.map((date) => (calendar.get(date)?.budget ?? 0) + (reserveByDay.get(date) ?? 0));
  const capSuffix = new Array<number>(dates.length + 1).fill(0);
  for (let i = dates.length - 1; i >= 0; i -= 1) capSuffix[i] = capSuffix[i + 1] + capBase[i];

  interface CurveState {
    material: Material;
    ranges: UnitRange[];
    curveStart: ISODate;
    curveEnd: ISODate;
    windowCapacity: number;
    targetByDate: Map<ISODate, number>;
    cumTarget: number;
    needMinutes: number;
    scheduledMinutes: number;
    weight: number;
    perDayCap: number;
  }
  const curves: CurveState[] = curveMaterials.map((material) => {
    const ranges = rangesByMaterial.get(material.id)!;
    const finish = preferredFinishDateFor(material);
    const curveStart = material.startDate > today ? material.startDate : today;
    const curveEnd = finish < curveStart ? curveStart : finish;
    const startIdx = dateIndex.get(curveStart) ?? 0;
    const endIdx = dateIndex.get(curveEnd) ?? dates.length - 1;
    const subject = state.subjects.find((item) => item.id === material.subjectId);
    return {
      material,
      ranges,
      curveStart,
      curveEnd,
      windowCapacity: capSuffix[startIdx] - capSuffix[endIdx + 1],
      targetByDate: new Map<ISODate, number>(),
      cumTarget: 0,
      needMinutes: minutesForUnits(material.minutesPerUnit, sumRangeLengths(ranges)),
      scheduledMinutes: 0,
      weight: 0.6 + (material.priority + (subject?.importance ?? 3) + (subject?.weakness ?? 3) + material.examRelevance) / 20,
      perDayCap: Math.min(
        material.maxMinutesPerDay ?? Number.POSITIVE_INFINITY,
        material.maxUnitsPerDay !== undefined ? minutesForUnits(material.minutesPerUnit, material.maxUnitsPerDay) : Number.POSITIVE_INFINITY,
      ),
    };
  });
  const curveByMaterial = new Map(curves.map((curve) => [curve.material.id, curve]));
  const progressDeficits: ProgressDeficit[] = [];
  for (const curve of curves) {
    if (curve.needMinutes > 0 && curve.windowCapacity <= 0) {
      warnings.push({ code: 'NO_ELIGIBLE_CAPACITY', targetId: curve.material.id, message: `${curve.material.name}は推奨完了日までに利用可能容量がありません` });
    }
  }
  // 日別容量を必要シェアで正規化しながら累積目標を作る
  for (let i = 0; i < dates.length; i += 1) {
    const date = dates[i];
    const capacity = capBase[i];
    const active = curves.filter((curve) => curve.needMinutes > 0 && date >= curve.curveStart && date <= curve.curveEnd);
    if (active.length === 0 || capacity <= 0) {
      for (const curve of active) curve.targetByDate.set(date, curve.cumTarget);
      continue;
    }
    const rated = active.map((curve) => {
      const endIdx = dateIndex.get(curve.curveEnd) ?? dates.length - 1;
      const remainingWindow = Math.max(1, capSuffix[i] - capSuffix[endIdx + 1]);
      return { curve, rate: Math.min(1, curve.needMinutes / remainingWindow) };
    });
    const totalRate = rated.reduce((sum, item) => sum + item.rate, 0);
    const totalWeighted = rated.reduce((sum, item) => sum + item.rate * item.curve.weight, 0);
    for (const { curve, rate } of rated) {
      const share = totalRate > 1 ? (rate * curve.weight) / Math.max(totalWeighted, 0.0001) : rate;
      const alloc = Math.min(capacity * share, curve.perDayCap, curve.needMinutes);
      curve.cumTarget += alloc;
      curve.needMinutes -= alloc;
      curve.targetByDate.set(date, curve.cumTarget);
    }
  }
  const curveTargetAt = (curve: CurveState, date: ISODate): number => {
    if (date < curve.curveStart) return 0;
    return curve.targetByDate.get(date) ?? (date > curve.curveEnd ? curve.cumTarget : 0);
  };

  // ---------- 日次ループ: 期限を守る最低予約 → 進捗曲線に沿った配分 ----------
  const feasibleStrictWorks = strictWorks
    .filter((work) => work.verdict === 'feasible')
    .sort((a, b) => a.deadline.localeCompare(b.deadline) || a.workItemId.localeCompare(b.workItemId));
  const chunkUnitsFor = (material: Material) =>
    material.maximumChunkUnits ?? Math.max(material.unitStep ?? 1, Math.floor(sessionMax / material.minutesPerUnit));
  for (let dateIdx = 0; dateIdx < dates.length && dates[dateIdx] <= concreteEnd; dateIdx += 1) {
    const date = dates[dateIdx];
    const day = calendar.get(date);
    if (!day) continue;
    // 1) 期限保証のための最低予約分を配置する
    for (const work of feasibleStrictWorks) {
      const entries = reservations.get(work.workItemId);
      const entry = entries?.get(date);
      if (!entries || !entry) continue;
      entries.delete(date);
      releaseReserve(date, entry.minutes);
      if (work.material) {
        const ranges = rangesByMaterial.get(work.material.id)!;
        const before = sumRangeLengths(ranges);
        const placed = allocateMaterial(work.material, ranges, calendar, date, date, entry.units, 95, sessionMin, sessionMax, assignments, fixed.valid);
        assignments.push(...placed);
        const placedUnits = before - sumRangeLengths(ranges);
        const curve = curveByMaterial.get(work.material.id);
        if (curve) curve.scheduledMinutes += placed.reduce((sum, item) => sum + item.end - item.start, 0);
        if (entry.units - placedUnits > 0) carryReservation(work, date, entry.units - placedUnits);
      } else if (work.task) {
        const scheduling = work.task.manualScheduling;
        const splittable = scheduling?.splittable ?? false;
        const minimum = Math.max(1, scheduling?.minimumChunkMinutes ?? entry.minutes);
        const maximum = Math.max(minimum, scheduling?.maximumChunkMinutes ?? entry.minutes);
        let remaining = entry.minutes;
        while (remaining > 0) {
          const chunk = splittable ? Math.min(remaining, maximum) : remaining;
          if (chunk < minimum && chunk !== remaining) break;
          const slot = findSlot(day, chunk);
          if (!slot) break;
          reserve(day, slot.start, slot.end);
          assignments.push(taskAssignment(work.task, date, slot));
          remaining -= chunk;
          if (!splittable) break;
        }
        if (remaining > 0) carryReservation(work, date, remaining);
      }
    }
    // 2) 進捗曲線の負債分を配分する(strict教材も曲線対象。前倒し分は予約の後ろから解放)
    const candidates = curves
      .filter((curve) => curve.ranges.length > 0 && date >= curve.curveStart)
      .filter((curve) => {
        const strict = strictWorkByMaterial.get(curve.material.id);
        return !strict || date <= strict.deadline;
      })
      .map((curve) => ({ curve, debt: Math.max(0, curveTargetAt(curve, date) - curve.scheduledMinutes) }))
      .filter((candidate) => candidate.debt > 0)
      .sort((a, b) => b.debt - a.debt || a.curve.curveEnd.localeCompare(b.curve.curveEnd) || b.curve.material.priority - a.curve.material.priority || a.curve.material.id.localeCompare(b.curve.material.id));
    for (const { curve, debt } of candidates) {
      const material = curve.material;
      const wantedUnits = Math.min(Math.ceil(debt / material.minutesPerUnit), chunkUnitsFor(material));
      if (wantedUnits <= 0) continue;
      const before = sumRangeLengths(curve.ranges);
      const placed = allocateMaterial(material, curve.ranges, calendar, date, date, wantedUnits, 70, sessionMin, sessionMax, assignments, fixed.valid);
      if (placed.length === 0) continue;
      assignments.push(...placed);
      const placedUnits = before - sumRangeLengths(curve.ranges);
      curve.scheduledMinutes += placed.reduce((sum, item) => sum + item.end - item.start, 0);
      const strict = strictWorkByMaterial.get(material.id);
      if (strict) trimReservation(strict, placedUnits);
    }
  }

  // ---------- 余剰時間による前倒し(決定的スコア順) ----------
  const scored = curveMaterials
    .map((material) => {
      const ranges = rangesByMaterial.get(material.id)!;
      const curve = curveByMaterial.get(material.id);
      const debt = curve ? Math.max(0, curveTargetAt(curve, concreteEnd < curve.curveEnd ? concreteEnd : curve.curveEnd) - curve.scheduledMinutes) : 0;
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
    while ((calendar.get(date)?.budget ?? 0) >= sessionMin) {
      const pool = scored
        .filter(({ material }) => material.startDate <= date && (rangesByMaterial.get(material.id)?.length ?? 0) > 0)
        .filter(({ material }) => {
          const strict = strictWorkByMaterial.get(material.id);
          return !strict || date <= strict.deadline;
        })
        .sort((a, b) =>
          Number(a.material.id === lastSurplusMaterial) - Number(b.material.id === lastSurplusMaterial)
          || sumRangeLengths(rangesByMaterial.get(b.material.id) ?? []) - sumRangeLengths(rangesByMaterial.get(a.material.id) ?? [])
          || b.score - a.score
          || a.material.id.localeCompare(b.material.id));
      let placedAny = false;
      for (const { material, score } of pool) {
        const ranges = rangesByMaterial.get(material.id)!;
        const before = sumRangeLengths(ranges);
        const placed = allocateMaterial(material, ranges, calendar, date, date, chunkUnitsFor(material), score * 100, sessionMin, sessionMax, assignments, fixed.valid);
        if (placed.length === 0) continue;
        assignments.push(...placed);
        const curve = curveByMaterial.get(material.id);
        if (curve) curve.scheduledMinutes += placed.reduce((sum, item) => sum + item.end - item.start, 0);
        const strict = strictWorkByMaterial.get(material.id);
        if (strict) trimReservation(strict, before - sumRangeLengths(ranges));
        lastSurplusMaterial = material.id;
        placedAny = true;
        break;
      }
      if (!placedAny) break;
    }
  }

  // ---------- 進捗負債(共有容量で正規化した目標に対する不足) ----------
  for (const curve of curves) {
    const boundDate = curve.curveEnd < concreteEnd ? curve.curveEnd : concreteEnd;
    const target = curve.windowCapacity <= 0
      ? minutesForUnits(curve.material.minutesPerUnit, sumRangeLengths(curve.ranges) + Math.round(curve.scheduledMinutes / curve.material.minutesPerUnit))
      : curveTargetAt(curve, boundDate);
    const deficitMinutes = Math.max(0, Math.round(target - curve.scheduledMinutes));
    if (deficitMinutes > 0) {
      progressDeficits.push({
        materialId: curve.material.id,
        units: Math.max(1, Math.ceil(deficitMinutes / curve.material.minutesPerUnit)),
        minutes: deficitMinutes,
        calculatedForDate: boundDate,
      });
    }
  }

  // ---------- strict期限レポート ----------
  let strictIndeterminateMinutes = 0;
  let strictInfeasibleMinutes = 0;
  for (const work of strictWorks) {
    const placedWithinDeadline = assignments
      .filter((assignment) => assignment.workItemId === work.workItemId && assignment.date <= work.deadline)
      .reduce((sum, assignment) => sum + assignment.end - assignment.start, 0);
    const reservedLeft = [...(reservations.get(work.workItemId)?.values() ?? [])].reduce((sum, entry) => sum + entry.minutes, 0);
    if (work.verdict === 'infeasible') {
      // 全ロールバック済み: 採用された配置は0分なので不足は全量
      strictInfeasibleMinutes += work.requiredMinutes;
      unscheduled.push({ workItemId: work.workItemId, sourceId: work.sourceId, minutes: work.requiredMinutes, reason: '厳守期限までの区間容量またはチャンク条件が不足しています' });
      deadlineReports.push({ workItemId: work.workItemId, policy: 'strict', deadline: work.deadline, feasible: false, scheduledMinutes: 0, requiredMinutes: work.requiredMinutes, shortageMinutes: work.requiredMinutes, overdueDays: 0 });
    } else if (work.verdict === 'indeterminate') {
      const shortage = Math.max(0, work.requiredMinutes - placedWithinDeadline);
      strictIndeterminateMinutes += shortage;
      unscheduled.push({ workItemId: work.workItemId, sourceId: work.sourceId, minutes: shortage, reason: '探索上限に達したため配置可能性を確定できませんでした' });
      deadlineReports.push({ workItemId: work.workItemId, policy: 'strict', deadline: work.deadline, feasible: null, scheduledMinutes: placedWithinDeadline, requiredMinutes: work.requiredMinutes, shortageMinutes: shortage, overdueDays: 0 });
    } else {
      const guaranteed = placedWithinDeadline + reservedLeft;
      const shortage = Math.max(0, work.requiredMinutes - guaranteed);
      if (shortage > 0) {
        strictInfeasibleMinutes += shortage;
        unscheduled.push({ workItemId: work.workItemId, sourceId: work.sourceId, minutes: shortage, reason: '空き区間の断片化により予約分を配置できませんでした' });
      }
      deadlineReports.push({ workItemId: work.workItemId, policy: 'strict', deadline: work.deadline, feasible: shortage === 0, scheduledMinutes: guaranteed, requiredMinutes: work.requiredMinutes, shortageMinutes: shortage, overdueDays: 0 });
    }
  }

  // ---------- normal/flexible教材のレポート ----------
  for (const material of activeMaterials.filter((item) => item.deadlinePolicy !== 'strict')) {
    const ranges = rangesByMaterial.get(material.id)!;
    const remaining = sumRangeLengths(ranges);
    const materialAssignments = assignments.filter((assignment) => assignment.materialId === material.id && assignment.workItemId === `material:${material.id}`);
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
  const strictViolations = deadlineReports.filter((report) => report.policy === 'strict' && report.feasible === false).length;
  const anyIndeterminate = strictWorks.some((work) => work.verdict === 'indeterminate');
  const requiredMinutes = activeMaterials.reduce((sum, material) => sum + initialUnits(material) * material.minutesPerUnit, 0)
    + movableTasks.reduce((sum, task) => sum + task.estimatedMinutes, 0)
    + strictTasks.reduce((sum, task) => sum + task.estimatedMinutes, 0);
  const shortage = Math.max(0, strictInfeasibleMinutes);
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
      affectedWorkItemIds: deadlineReports.filter((report) => report.policy === 'strict' && report.feasible === false).map((report) => report.workItemId),
      suggestedActions: [
        { type: 'increaseDailyMinutes', value: Math.ceil(shortage / Math.max(1, diffDays(today, feasibilityEnd) + 1)), label: `1日あたり${Math.ceil(shortage / Math.max(1, diffDays(today, feasibilityEnd) + 1))}分増やす` },
        { type: 'allowSplit', label: '分割不可の作業を分割可能にする' },
        { type: 'extendDeadline', label: '厳守期限を延長する' },
      ],
    }] : [],
  };
  const objectiveReport: ObjectiveReport = {
    ...EMPTY_OBJECTIVE,
    strictDeadlineViolations: strictViolations,
    lockViolations: fixed.conflicts.length,
    unscheduledStrictMinutes: strictInfeasibleMinutes + strictIndeterminateMinutes,
    progressDebtMinutes: progressDeficits.reduce((sum, deficit) => sum + deficit.minutes, 0),
    normalOverdueMinutes: deadlineReports.filter((report) => report.policy === 'normal').reduce((sum, report) => sum + report.shortageMinutes, 0),
    unscheduledMinutes: unscheduled.reduce((sum, item) => sum + item.minutes, 0),
    subjectImbalance: computeSubjectImbalance(state, scheduledTasks),
    timePreferenceViolations: countTimePreferenceViolations(state, scheduledTasks),
    taskSwitches: countSwitches(scheduledTasks),
    sameMaterialStreak: countMaterialStreaks(scheduledTasks),
  };
  const result: ScheduleGenerationResult = {
    status: fixed.conflicts.length > 0
      ? 'conflict'
      : anyIndeterminate
        ? 'indeterminate'
        : strictViolations > 0 || strictInfeasibleMinutes > 0
          ? 'infeasible'
          : unscheduled.length > 0 ? 'partial' : 'success',
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

function countMaterialStreaks(tasks: StudyTask[]) {
  let streaks = 0;
  let previous: StudyTask | undefined;
  for (const task of tasks) {
    if (previous && previous.scheduledDate === task.scheduledDate && previous.materialId !== null && previous.materialId === task.materialId) streaks += 1;
    previous = task;
  }
  return streaks;
}

function computeSubjectImbalance(state: AppState, tasks: StudyTask[]): number {
  const bySubject = new Map<string, number>();
  for (const task of tasks) {
    if (task.status !== 'planned') continue;
    bySubject.set(task.subjectId, (bySubject.get(task.subjectId) ?? 0) + task.estimatedMinutes);
  }
  const activeSubjects = new Set(state.materials.filter((material) => !material.paused && !material.archived).map((material) => material.subjectId));
  if (activeSubjects.size <= 1) return 0;
  const values = [...activeSubjects].map((subjectId) => bySubject.get(subjectId) ?? 0);
  return Math.max(...values) - Math.min(...values);
}

function countTimePreferenceViolations(state: AppState, tasks: StudyTask[]): number {
  let violations = 0;
  for (const task of tasks) {
    if (!task.materialId || !task.scheduledStart || !task.scheduledEnd) continue;
    const material = state.materials.find((item) => item.id === task.materialId);
    const windows = material?.preferredTimeWindows?.filter((window) => window.preference > 0) ?? [];
    if (windows.length === 0) continue;
    const start = hmToMinutes(task.scheduledStart);
    const end = hmToMinutes(task.scheduledEnd);
    const inWindow = windows.some((window) => start < hmToMinutes(window.end) && end > hmToMinutes(window.start));
    if (!inWindow) violations += 1;
  }
  return violations;
}

export function validateGeneratedScheduleV2(state: AppState, result: ScheduleGenerationResult, context: SchedulerContext): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const today = dateInTimeZone(context.now, context.timezone);
  const calendar = buildCalendar(state, context, today, result.capacityReport.horizonEnd);
  const byDate = new Map<ISODate, StudyTask[]>();
  const ids = new Set<string>();
  const rangesByMaterial = new Map<string, UnitRange[]>();
  const materialDayUsage = new Map<string, { units: number; minutes: number }>();
  // 完了済み・固定・日付固定タスクが請求する範囲を除いた「残り断片」の境界。
  // 断片の末尾で終わるチャンクは、unitStep・最小チャンク制約の例外(最終残量)として扱う。
  const claimsByMaterial = new Map<string, UnitRange[]>();
  const claimTasks = [
    ...state.tasks.filter((task) => task.status === 'done'),
    ...result.scheduledTasks.filter((task) => task.status === 'doing' || effectiveLock(task) !== 'none'),
  ];
  for (const task of claimTasks) {
    if (!task.materialId) continue;
    const range = taskRange(task);
    if (range) claimsByMaterial.set(task.materialId, [...(claimsByMaterial.get(task.materialId) ?? []), range]);
  }
  const fragmentEndsByMaterial = new Map<string, Set<number>>();
  const fragmentEndsFor = (material: Material): Set<number> => {
    let ends = fragmentEndsByMaterial.get(material.id);
    if (!ends) {
      const completed = normalizeUnitRanges(material.completedRanges ?? (material.doneAmount > 0 ? [{ start: 1, end: material.doneAmount }] : []), materialTotal(material));
      const fragments = removeClaimedRanges(remainingUnitRanges(materialTotal(material), completed), claimsByMaterial.get(material.id) ?? []);
      ends = new Set(fragments.map((fragment) => fragment.end));
      fragmentEndsByMaterial.set(material.id, ends);
    }
    return ends;
  };
  for (const task of result.scheduledTasks) {
    if (ids.has(task.id)) errors.push(issue(task.id, 'id', task.id, 'タスクIDが重複しています', '決定的ID入力を確認してください'));
    ids.add(task.id);
    const isDoing = task.status === 'doing';
    if (task.placementStatus !== 'scheduled' || !task.scheduledStart || !task.scheduledEnd) {
      if (!isDoing) errors.push(issue(task.id, 'placementStatus', task.placementStatus, '配置済みタスクに時刻がありません', '未配置として返してください'));
    }
    if (!task.scheduledStart || !task.scheduledEnd) continue;
    const start = hmToMinutes(task.scheduledStart);
    const end = hmToMinutes(task.scheduledEnd);
    if (!isDoing) {
      if (end - start !== task.estimatedMinutes) errors.push(issue(task.id, 'estimatedMinutes', task.estimatedMinutes, '時刻差と見積時間が一致しません', '終了時刻を再計算してください'));
      const day = calendar.get(task.scheduledDate);
      if (!day || !day.slots.some((slot) => start >= slot.start && end <= slot.end)) errors.push(issue(task.id, 'scheduledStart', task.scheduledStart, '利用可能時間または現在時刻より前へ配置されています', '空き区間内へ配置してください'));
    }
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
        const finalRemainder = range.end === materialTotal(material) || fragmentEndsFor(material).has(range.end);
        if (units % (material.unitStep ?? 1) !== 0 && !finalRemainder) errors.push(issue(task.id, 'materialRange', range, 'unitStepに一致しません', `${material.unitStep ?? 1}単位刻みへ丸めてください`));
        if (material.minimumChunkUnits !== undefined && units < material.minimumChunkUnits && !finalRemainder) errors.push(issue(task.id, 'materialRange', range, '最小チャンク未満です', '最終残量以外は最小チャンク以上にしてください'));
        if (material.splittable !== false && material.maximumChunkUnits !== undefined && units > material.maximumChunkUnits && !(units === 1 && task.estimatedMinutes > state.settings.sessionMaxMinutes)) errors.push(issue(task.id, 'materialRange', range, '最大チャンクを超えています', 'タスクを分割してください'));
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
    const sorted = tasks.filter((task) => task.status !== 'doing').sort((a, b) => a.scheduledStart!.localeCompare(b.scheduledStart!));
    for (let i = 1; i < sorted.length; i += 1) if (sorted[i - 1].scheduledEnd! > sorted[i].scheduledStart!) errors.push(issue(sorted[i].id, 'scheduledStart', sorted[i].scheduledStart, 'タスク同士が重複しています', '別の空き区間へ配置してください'));
    const budget = calendar.get(date)?.originalBudget ?? 0;
    const used = tasks.reduce((sum, task) => sum + task.estimatedMinutes, 0);
    // ユーザーが明示的に時刻固定したタスクは予算超過でも維持する(警告済み)。自動タスク分だけが予算内に収まればよい。
    const lockedMinutes = tasks.filter((task) => task.status === 'doing' || effectiveLock(task) === 'time').reduce((sum, task) => sum + task.estimatedMinutes, 0);
    if (used > Math.max(budget, lockedMinutes)) errors.push(issue(date, 'dailyBudget', used, '日別予算を超えています', `${budget}分以内へ減らしてください`));
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
