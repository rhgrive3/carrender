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
  SchedulerDiagnostics,
  StudyTask,
  StudySession,
  TimeRange,
  UnitRange,
  UnscheduledWorkItem,
  ValidationIssue,
} from '../types';
import { addDays, diffDays, hmToMinutes, minutesInTimeZone, minutesToHM, toISODate, weekdayOf } from './date';
import type { SlotAllocation, SolverDayInput, SolverItem } from './strictSolver';
import { compareItemsForSearch, countItemPlacements, minutesForUnits, solveStrict } from './strictSolver';
import { ESTIMATE_POLICY, SCHEDULER_POLICY } from './schedulerPolicy';
import { earliestDateMeetingCapacity, minimumFeasibleSteppedValue } from './capacitySearch';
import { classifyUnscheduledReason, createSchedulerDiagnostics, requirePositiveSchedulerValue } from './schedulerDiagnostics';

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
  maxDailyMinutes: 0,
  dailyLoadVariance: 0,
  adjacentDayDifference: 0,
  consecutiveHeavyDays: 0,
  subjectConcentration: 0,
  materialConcentration: 0,
  cadenceViolations: 0,
  dailyTargetDeviation: 0,
  weeklyTargetDeviation: 0,
  safetyBufferViolationMinutes: 0,
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
  alpha = ESTIMATE_POLICY.smoothingAlpha,
): EstimateUpdateResult {
  const raw = sessions
    .filter((session) => session.materialId === material.id && !session.excludedFromEstimate && !session.pausedMinutes && session.minutes >= 1 && session.amountDone > 0)
    .map((session) => session.minutes / session.amountDone)
    .filter((value) => Number.isFinite(value) && value > 0);
  const center = median(raw);
  const mad = median(raw.map((value) => Math.abs(value - center)));
  const valid = raw.filter((value) => value >= center * ESTIMATE_POLICY.medianRatioFloor
      && value <= center * ESTIMATE_POLICY.medianRatioCeiling
      && (mad === 0 || Math.abs(value - center) <= mad * ESTIMATE_POLICY.madMultiplier));
  const observed = valid.length > 0 ? median(valid) : null;
  const boundedAlpha = Math.max(0, Math.min(1, alpha));
  const smoothed = observed === null ? null : material.minutesPerUnit * (1 - boundedAlpha) + observed * boundedAlpha;
  const suggested = smoothed === null ? null : Math.max(
    material.minutesPerUnit * (1 - ESTIMATE_POLICY.maxRelativeDecrease),
    Math.min(material.minutesPerUnit * (1 + ESTIMATE_POLICY.maxRelativeIncrease), smoothed),
  );
  const applied = valid.length >= ESTIMATE_POLICY.minimumSamples && material.estimateMode === 'auto' && suggested !== null;
  return {
    previousEstimate: material.minutesPerUnit,
    observedEstimate: observed,
    suggestedEstimate: valid.length >= ESTIMATE_POLICY.minimumSamples ? suggested : null,
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

function preferredFinishDateFor(material: Material): ISODate {
  if (material.preferredFinishDate) return material.preferredFinishDate;
  const span = Math.max(0, diffDays(material.startDate, material.targetDate));
  if (material.deadlinePolicy === 'flexible') return material.targetDate;
  const ratio = material.deadlinePolicy === 'strict'
    ? SCHEDULER_POLICY.strictPreferredFinishRatio
    : SCHEDULER_POLICY.normalPreferredFinishRatio;
  const minimumLead = material.deadlinePolicy === 'strict'
    ? SCHEDULER_POLICY.strictMinimumLeadDays
    : SCHEDULER_POLICY.normalMinimumLeadDays;
  const proportional = addDays(material.startDate, Math.floor(span * ratio));
  const leadDate = addDays(material.targetDate, -minimumLead);
  return proportional < material.startDate ? material.startDate : proportional > leadDate ? (leadDate < material.startDate ? material.startDate : leadDate) : proportional;
}

interface SafetyFinishInput {
  start: ISODate;
  deadline: ISODate;
  deadlinePolicy: Material['deadlinePolicy'];
  preferredFinishDate?: ISODate;
  requiredMinutes: number;
  /** 固定予定を引いた、日ごとの実際に使える容量。 */
  capacityByDate: ReadonlyArray<{ date: ISODate; minutes: number }>;
}

/**
 * 期限当日を通常の完了日として使わない。暦日ではなく、固定予定を引いた容量で
 * 予備を残せる最も早い日を求める。容量が足りない場合だけ期限へ近づける。
 */
function computeSafetyFinishDate(input: SafetyFinishInput): ISODate {
  const span = Math.max(0, diffDays(input.start, input.deadline));
  const baseReserve = span <= SCHEDULER_POLICY.reserveShortSpanMaxDays
    ? SCHEDULER_POLICY.reserveShortDays
    : span <= SCHEDULER_POLICY.reserveMediumSpanMaxDays
      ? SCHEDULER_POLICY.reserveMediumDays
      : span <= SCHEDULER_POLICY.reserveLongSpanMaxDays
        ? SCHEDULER_POLICY.reserveLongDays
        : Math.ceil(span * SCHEDULER_POLICY.reserveProportion);
  const reserve = input.deadlinePolicy === 'strict'
    ? baseReserve + SCHEDULER_POLICY.strictAdditionalReserveDays
    : baseReserve;
  let finish = input.preferredFinishDate
    ? (input.preferredFinishDate < input.start ? input.start : input.preferredFinishDate > input.deadline ? input.deadline : input.preferredFinishDate)
    : addDays(input.deadline, -reserve);
  if (finish < input.start) finish = input.start;
  return earliestDateMeetingCapacity(
    input.capacityByDate,
    input.start,
    finish,
    input.deadline,
    input.requiredMinutes,
  );
}

function mondayKey(date: ISODate): ISODate {
  // weekdayOfは日曜=0。既存の週表示と同じ月曜始まりへ寄せる。
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

/** 頻度指定の候補日を週の中で均等に選ぶ。容量不足なら後段で日を追加する。 */
function selectCadenceDates(
  material: Material,
  dates: ReadonlyArray<ISODate>,
  capacityForDate: (date: ISODate) => number,
): Set<ISODate> {
  const cadence = material.preferredCadence ?? { type: 'auto' as const };
  const eligible = dates.filter((date) => date >= material.startDate && capacityForDate(date) > 0);
  if (cadence.type !== 'timesPerWeek') return new Set(eligible);
  const selected = new Set<ISODate>();
  const byWeek = new Map<ISODate, ISODate[]>();
  for (const date of eligible) byWeek.set(mondayKey(date), [...(byWeek.get(mondayKey(date)) ?? []), date]);
  for (const [, weekDates] of [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const count = Math.min(Math.max(1, cadence.count), weekDates.length);
    for (let index = 0; index < count; index += 1) {
      const position = Math.min(weekDates.length - 1, Math.floor((index + 0.5) * weekDates.length / count));
      selected.add(weekDates[position]);
    }
  }
  return selected;
}

function extendCadenceForCapacity(
  selected: Set<ISODate>,
  dates: ReadonlyArray<ISODate>,
  capacityForDate: (date: ISODate) => number,
  requiredMinutes: number,
): Set<ISODate> {
  let total = [...selected].reduce((sum, date) => sum + capacityForDate(date), 0);
  // 指定頻度だけで物理的に無理なら、期限保証を優先して中央寄りの日から増やす。
  const extras = dates.filter((date) => capacityForDate(date) > 0 && !selected.has(date));
  for (const date of extras) {
    if (total >= requiredMinutes) break;
    selected.add(date);
    total += capacityForDate(date);
  }
  return selected;
}

interface BalancedLoadDay {
  date: ISODate;
  availableMinutes: number;
  baseLoadMinutes: number;
}

interface BalancedLoadItem {
  id: string;
  release: ISODate;
  deadline: ISODate;
  requiredUnits: number;
  minutesPerUnit: number;
  cadenceDates: ReadonlySet<ISODate>;
  perDayCap: number;
  maxUnitsPerDay?: number;
  splittable: boolean;
}

function normalMinutesAtLoadCap(day: BalancedLoadDay, loadCap: number): number {
  return Math.max(0, Math.min(day.availableMinutes, loadCap - day.baseLoadMinutes));
}

function unitsAvailableOnBalancedDay(item: BalancedLoadItem, day: BalancedLoadDay, loadCap: number): number {
  if (day.date < item.release || day.date > item.deadline || !item.cadenceDates.has(day.date)) return 0;
  const minutes = Math.min(normalMinutesAtLoadCap(day, loadCap), item.perDayCap);
  return Math.max(0, Math.min(
    Math.floor(minutes / Math.max(item.minutesPerUnit, 0.0001)),
    item.maxUnitsPerDay ?? Number.POSITIVE_INFINITY,
  ));
}

function unitsAvailableAcrossBalancedDays(
  item: BalancedLoadItem,
  days: ReadonlyArray<BalancedLoadDay>,
  loadCap: number,
): number {
  if (!item.splittable) {
    return days.some((day) => unitsAvailableOnBalancedDay(item, day, loadCap) >= item.requiredUnits)
      ? item.requiredUnits
      : 0;
  }
  return days.reduce((sum, day) => sum + unitsAvailableOnBalancedDay(item, day, loadCap), 0);
}

/**
 * 既に予約されたstrict・手動タスクを含む総日負荷の最小上限を求める。
 * 単純平均だけでなく、教材の開始日・安全完了日・頻度日・単位幅を使った
 * 累積必要量を確認するため、低すぎて後半に未配置を生む上限は採用しない。
 */
function minimumBalancedDailyLoadCap(
  items: ReadonlyArray<BalancedLoadItem>,
  days: ReadonlyArray<BalancedLoadDay>,
  minimumStepMinutes = SCHEDULER_POLICY.balancedLoadStepMinutes,
): number {
  if (items.length === 0 || days.length === 0) return 0;
  const activeDays = days.filter((day) => items.some((item) =>
    day.date >= item.release && day.date <= item.deadline && item.cadenceDates.has(day.date)));
  if (activeDays.length === 0) return 0;
  const totalRequired = items.reduce((sum, item) => sum + minutesForUnits(item.minutesPerUnit, item.requiredUnits), 0);
  const baseTotal = activeDays.reduce((sum, day) => sum + day.baseLoadMinutes, 0);
  const maximumLoad = activeDays.reduce((max, day) => Math.max(max, day.baseLoadMinutes + day.availableMinutes), 0);
  let loadCap = Math.max(
    ...activeDays.map((day) => day.baseLoadMinutes),
    Math.ceil(((totalRequired + baseTotal) / activeDays.length) / minimumStepMinutes) * minimumStepMinutes,
  );

  const couldFit = (candidateCap: number) => {
    if (!items.every((item) => unitsAvailableAcrossBalancedDays(item, activeDays, candidateCap) >= item.requiredUnits)) return false;
    for (const cutoff of activeDays.map((day) => day.date)) {
      let mandatoryMinutes = 0;
      for (const item of items) {
        const unitsAfter = unitsAvailableAcrossBalancedDays(
          item,
          activeDays.filter((day) => day.date > cutoff),
          candidateCap,
        );
        mandatoryMinutes += minutesForUnits(item.minutesPerUnit, Math.max(0, item.requiredUnits - unitsAfter));
      }
      const sharedCapacity = activeDays
        .filter((day) => day.date <= cutoff)
        .reduce((sum, day) => sum + normalMinutesAtLoadCap(day, candidateCap), 0);
      if (mandatoryMinutes > sharedCapacity) return false;
    }
    return true;
  };

  while (loadCap < maximumLoad && !couldFit(loadCap)) loadCap += minimumStepMinutes;
  return Math.min(maximumLoad, loadCap);
}

/**
 * 実際の空き区間・チャンク幅を考慮した、1日内に確実に置ける通常単位数の下限。
 * 端数チャンクは数えないため保守的だが、連続していない空き時間を合算して
 * 「置ける」と誤判定することはない。平準化上限の事前判定でのみ使う。
 */
function regularUnitsPackableInSlot(item: SolverItem, fitUnits: number): number {
  if (fitUnits <= 0) return 0;
  if (!item.splittable) return fitUnits >= item.requiredUnits ? item.requiredUnits : 0;
  const step = Math.max(1, item.unitStep);
  const minimum = Math.ceil(item.minChunkUnits / step) * step;
  const maximum = Math.floor(Math.min(item.maxChunkUnits, fitUnits) / step) * step;
  if (maximum < minimum) return 0;
  let target = Math.floor(fitUnits / step) * step;
  while (target >= minimum) {
    const minimumChunks = Math.ceil(target / maximum);
    const maximumChunks = Math.floor(target / minimum);
    if (minimumChunks <= maximumChunks) return target;
    target -= step;
  }
  return 0;
}

function solverUnitsAvailableOnDay(item: SolverItem, day: SolverDayInput, loadCap: number): number {
  if (day.date < item.release || day.date > item.deadline || loadCap <= 0) return 0;
  const minuteLimit = Math.max(0, Math.min(
    day.budget,
    loadCap,
    item.maxMinutesPerDay ?? Number.POSITIVE_INFINITY,
  ));
  const unitLimit = Math.max(0, Math.min(
    item.requiredUnits,
    item.maxUnitsPerDay ?? Number.POSITIVE_INFINITY,
  ));
  if (minuteLimit <= 0 || unitLimit <= 0) return 0;
  if (!item.splittable) {
    const requiredMinutes = minutesForUnits(item.minutesPerUnit, item.requiredUnits);
    return requiredMinutes <= minuteLimit
      && day.slots.some((slot) => slot.end - slot.start >= requiredMinutes)
      && item.requiredUnits <= unitLimit
      ? item.requiredUnits
      : 0;
  }

  let remainingMinutes = minuteLimit;
  let remainingUnits = unitLimit;
  let packedUnits = 0;
  const slots = [...day.slots].sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  for (const slot of slots) {
    if (remainingMinutes <= 0 || remainingUnits <= 0) break;
    const usableMinutes = Math.min(slot.end - slot.start, remainingMinutes);
    const fitUnits = Math.min(
      remainingUnits,
      Math.floor(usableMinutes / Math.max(item.minutesPerUnit, 0.0001)),
    );
    const units = regularUnitsPackableInSlot(item, fitUnits);
    if (units <= 0) continue;
    const minutes = minutesForUnits(item.minutesPerUnit, units);
    packedUnits += units;
    remainingUnits -= units;
    remainingMinutes -= minutes;
  }
  return packedUnits;
}

function withBalancedDailyUnitsCap(
  work: StrictWork,
  item: SolverItem,
  days: ReadonlyArray<SolverDayInput>,
): SolverItem {
  const material = work.material;
  if (!material
    || !item.splittable
    || item.maxUnitsPerDay !== undefined
    || item.maxMinutesPerDay !== undefined
    || material.dailyTarget !== null
    || material.weeklyTarget !== null) return item;
  const step = Math.max(1, item.unitStep);
  const sessionUnits = Math.floor(item.maxChunkUnits / step) * step;
  if (sessionUnits < item.minChunkUnits) return item;
  const eligibleDays = days.filter((day) =>
    day.date >= item.release
    && day.date <= item.deadline
    && solverUnitsAvailableOnDay(item, day, day.budget) >= Math.min(item.minChunkUnits, item.requiredUnits));
  if (eligibleDays.length <= 0) return item;
  const requiredSessions = Math.ceil(item.requiredUnits / sessionUnits);
  const sessionsPerDay = Math.max(1, Math.ceil(requiredSessions / eligibleDays.length));
  const capped = { ...item, maxUnitsPerDay: sessionsPerDay * sessionUnits };
  const availableUnits = eligibleDays.reduce(
    (sum, day) => sum + solverUnitsAvailableOnDay(capped, day, day.budget),
    0,
  );
  return availableUnits >= item.requiredUnits ? capped : item;
}

function relaxBalancedDailyUnitsCaps(
  works: ReadonlyArray<StrictWork>,
  items: ReadonlyArray<SolverItem>,
): SolverItem[] {
  return items.map((item, index) => {
    const original = works[index].solverItem;
    if (original.maxUnitsPerDay !== undefined || item.maxUnitsPerDay === undefined || !item.splittable) return item;
    const step = Math.max(1, item.unitStep);
    const sessionUnits = Math.floor(item.maxChunkUnits / step) * step;
    if (sessionUnits <= 0 || item.maxUnitsPerDay >= item.requiredUnits) return item;
    return { ...item, maxUnitsPerDay: Math.min(item.requiredUnits, item.maxUnitsPerDay + sessionUnits) };
  });
}

function balanceCapsForSharedDeadlines(
  works: ReadonlyArray<StrictWork>,
  initialItems: ReadonlyArray<SolverItem>,
  days: ReadonlyArray<SolverDayInput>,
): SolverItem[] {
  let items = [...initialItems];
  const cutoffs = [...new Set(days.map((day) => day.date))].sort();
  const necessaryBoundsHold = () => cutoffs.every((cutoff) => {
    let mandatoryMinutes = 0;
    for (const item of items) {
      const unitsAfter = days
        .filter((day) => day.date > cutoff)
        .reduce((sum, day) => sum + solverUnitsAvailableOnDay(item, day, day.budget), 0);
      mandatoryMinutes += minutesForUnits(item.minutesPerUnit, Math.max(0, item.requiredUnits - unitsAfter));
    }
    const sharedCapacity = days
      .filter((day) => day.date <= cutoff)
      .reduce((sum, day) => sum + day.budget, 0);
    return mandatoryMinutes <= sharedCapacity;
  });
  for (let attempt = 0; attempt < SCHEDULER_POLICY.maximumCapRelaxationAttempts && !necessaryBoundsHold(); attempt += 1) {
    const relaxed = relaxBalancedDailyUnitsCaps(works, items);
    if (relaxed.every((item, index) => item.maxUnitsPerDay === items[index].maxUnitsPerDay)) break;
    items = relaxed;
  }
  return items;
}

function earliestCapacityFinishDate(
  item: SolverItem,
  days: ReadonlyArray<SolverDayInput>,
): ISODate | null {
  let units = 0;
  for (const day of days) {
    if (day.date < item.release || day.date > item.deadline) continue;
    units += solverUnitsAvailableOnDay(item, day, day.budget);
    if (units >= item.requiredUnits) return day.date;
  }
  return null;
}

export function dateInTimeZone(date: Date, timeZone: string): ISODate {
  return toISODate(date, timeZone);
}

function issue(targetId: string, field: string, value: unknown, reason: string, suggestion: string): ValidationIssue {
  return { targetId, field, value, reason, suggestion };
}

function validateStateV2(state: AppState): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  for (const material of state.materials) {
    const total = material.totalUnits ?? material.totalAmount;
    if (!(total > 0)) errors.push(issue(material.id, 'totalUnits', total, '教材総量は0より大きい必要があります', '1以上を指定してください'));
    if (!(material.minutesPerUnit > 0)) errors.push(issue(material.id, 'minutesPerUnit', material.minutesPerUnit, '見積時間は0より大きい必要があります', '1以上を指定してください'));
    if (!((material.unitStep ?? 1) > 0)) errors.push(issue(material.id, 'unitStep', material.unitStep, '単位刻みは0より大きい必要があります', '1以上を指定してください'));
    if (material.targetDate && material.startDate > material.targetDate) errors.push(issue(material.id, 'targetDate', material.targetDate, '期限が開始日より前です', '開始日以降の日付を指定してください'));
    if (state.goal && !material.archived && material.targetDate > state.goal.examDate) errors.push(issue(material.id, 'targetDate', material.targetDate, '教材の目標完了日が試験日より後です', '試験日以前へ変更してください'));
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
  if (task.materialRange
    && Number.isFinite(task.materialRange.start)
    && Number.isFinite(task.materialRange.end)) return task.materialRange;
  return Number.isFinite(task.rangeStart) && Number.isFinite(task.rangeEnd)
    ? { start: task.rangeStart!, end: task.rangeEnd! }
    : undefined;
}

/**
 * タスクの配置ロック。旧データの推測はマイグレーション(normalizeState)で
 * 明示的なplacementLockに変換済みなので、実行時は明示値だけを見る。
 */
function effectiveLock(task: StudyTask): 'none' | 'date' | 'time' {
  if (task.manualScheduling?.placementPolicy === 'fixedTime') return 'time';
  if (task.manualScheduling?.placementPolicy === 'fixedDateFlexibleTime') return 'date';
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

function deterministicTaskId(generationId: string, workItemId: string, date: ISODate, start: string, range?: UnitRange) {
  return `task_${deterministicHash([generationId, workItemId, date, start, range?.start ?? '', range?.end ?? ''].join('|'))}`;
}

function taskFromAssignment(assignment: Assignment, context: SchedulerContext): StudyTask {
  const start = minutesToHM(assignment.start);
  const end = minutesToHM(assignment.end);
  if (assignment.template) {
    const split = assignment.template.manualScheduling?.splittable ?? false;
    const progressPolicy = assignment.template.manualScheduling?.progressPolicy;
    const manualScheduling = assignment.template.manualScheduling && progressPolicy?.type === 'countTowardMaterial'
      ? {
          ...assignment.template.manualScheduling,
          progressPolicy: { ...progressPolicy, range: assignment.range, amount: assignment.amount },
        }
      : assignment.template.manualScheduling;
    return {
      ...assignment.template,
      id: assignment.template.manualScheduling?.splittable
        ? deterministicTaskId(context.generationId, assignment.workItemId, assignment.date, start, assignment.range)
        : assignment.template.id,
      scheduledDate: assignment.date,
      scheduledStart: start,
      scheduledEnd: end,
      estimatedMinutes: assignment.end - assignment.start,
      amount: assignment.amount,
      rangeStart: assignment.range?.start ?? (split ? null : assignment.template.rangeStart),
      rangeEnd: assignment.range?.end ?? (split ? null : assignment.template.rangeEnd),
      materialRange: assignment.range ?? (split ? undefined : assignment.template.materialRange),
      rangeLabel: assignment.range
        ? (assignment.range.start === assignment.range.end ? `${assignment.range.start}` : `${assignment.range.start}〜${assignment.range.end}`)
        : assignment.template.rangeLabel,
      manualScheduling,
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
  const currentDate = dateInTimeZone(context.now, context.timezone);
  const planningStartDate = context.planningStartDate;
  const today = planningStartDate && planningStartDate > currentDate ? planningStartDate : currentDate;
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
  const release = lock === 'date' || task.type === 'review'
    ? task.scheduledDate
    : scheduling?.fixedDate ?? start;
  const deadline = lock === 'date' ? task.scheduledDate : strictDeadline ?? scheduling?.deadline ?? task.dueDate ?? end;
  let remaining = task.estimatedMinutes;
  let allocatedMinutes = 0;
  let allocatedAmount = 0;
  const explicitRange = taskRange(task);
  const assignments: Assignment[] = [];
  for (let date = release > start ? release : start; date <= deadline && date <= end && remaining > 0; date = addDays(date, 1)) {
    const day = calendar.get(date);
    if (!day) continue;
    // 分割可能な手動タスクは、同じ日の複数空き枠へ連続して置ける。
    while (remaining > 0) {
      const chunk = splittable ? Math.min(remaining, maximum) : remaining;
      const allowedSmallFinal = chunk === remaining;
      if (chunk < minimum && !allowedSmallFinal) break;
      const slot = findSlot(day, chunk);
      if (!slot) break;
      if (!reserve(day, slot.start, slot.end)) return null;
      const amountThrough = remaining === chunk
        ? task.amount
        : Math.round(task.amount * (allocatedMinutes + chunk) / Math.max(1, task.estimatedMinutes));
      const chunkAmount = Math.max(0, amountThrough - allocatedAmount);
      const range = explicitRange && chunkAmount > 0
        ? { start: explicitRange.start + allocatedAmount, end: explicitRange.start + allocatedAmount + chunkAmount - 1 }
        : undefined;
      assignments.push(taskAssignment(task, date, slot, chunkAmount, range));
      allocatedMinutes += chunk;
      allocatedAmount += chunkAmount;
      remaining -= chunk;
      if (!splittable) break;
    }
  }
  return remaining === 0 ? assignments : null;
}

function taskAssignment(
  task: StudyTask,
  date: ISODate,
  slot: MinuteRange,
  amount = task.amount,
  range = taskRange(task),
): Assignment {
  return {
    sourceType: task.sourceType ?? (task.generatedBy === 'manual' ? 'manual' : 'review'),
    sourceId: task.sourceId ?? task.id,
    // 分割後の子を次の再計算で親として扱っても、work itemは常に最初の
    // 手動タスクを指す。H(H(T)) のようなID連鎖を防ぐ。
    workItemId: `task:${task.sourceId ?? task.id}`,
    subjectId: task.subjectId,
    materialId: task.materialId,
    title: task.title,
    date,
    start: slot.start,
    end: slot.end,
    amount,
    range,
    priority: task.priority,
    dueDate: task.dueDate,
    type: task.type,
    template: task,
  };
}

function takeUnits(ranges: UnitRange[], requested: number, unitStep: number): UnitRange | null {
  // 先頭が最小チャンクに満たない飛び飛び残量でも、後ろの十分な断片を
  // 進められるようにする。小断片は最後の残量として後で扱う。
  const candidateIndex = ranges.findIndex((range) => range.end - range.start + 1 >= requested);
  const index = candidateIndex >= 0 ? candidateIndex : 0;
  const first = ranges[index];
  if (!first) return null;
  const available = first.end - first.start + 1;
  let units = Math.min(available, requested);
  if (units < available) units = Math.floor(units / unitStep) * unitStep;
  if (units <= 0) return null;
  const range = { start: first.start, end: first.start + units - 1 };
  if (range.end === first.end) ranges.splice(index, 1);
  else first.start = range.end + 1;
  return range;
}

function takeTailUnits(ranges: UnitRange[], requested: number): UnitRange | null {
  const last = ranges[ranges.length - 1];
  if (!last || requested <= 0 || requested > last.end - last.start + 1) return null;
  const range = { start: last.end - requested + 1, end: last.end };
  if (range.start === last.start) ranges.pop();
  else last.end = range.start - 1;
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
      // 0.1分/単位なども0分タスクにしない。予約に成功した分だけ範囲を
      // 消費するため、実時間ゼロで教材を完了予定にすることもない。
      const minutes = Math.max(1, Math.ceil(units * minutesPerUnit));
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
function compareObjectives(a: ObjectiveReport, b: ObjectiveReport): number {
  const keys: (keyof ObjectiveReport)[] = [
    'strictDeadlineViolations',
    'lockViolations',
    'unscheduledStrictMinutes',
    'progressDebtMinutes',
    'normalOverdueMinutes',
    'unscheduledMinutes',
    'safetyBufferViolationMinutes',
    'maxDailyMinutes',
    'consecutiveHeavyDays',
    'dailyLoadVariance',
    'adjacentDayDifference',
    'cadenceViolations',
    'dailyTargetDeviation',
    'weeklyTargetDeviation',
    'subjectImbalance',
    'subjectConcentration',
    'materialConcentration',
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
    diagnostics: createSchedulerDiagnostics(errors),
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
  const currentDate = dateInTimeZone(context.now, context.timezone);
  const planningStartDate = context.planningStartDate;
  const today = planningStartDate && planningStartDate > currentDate ? planningStartDate : currentDate;
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
  const configuredConcreteEnd = addDays(today, Math.max(1, state.settings.taskGenerationHorizonDays ?? 42) - 1);
  // The configured horizon is a rolling minimum, not permission to stop before
  // the user's active goal. Otherwise a 42-day plan generated on July 14 ends
  // on August 24 even when the goal itself is August 27, making the calendar
  // appear to break off while goal-scoped work still exists.
  const concreteEnd = state.goal?.examDate && state.goal.examDate > configuredConcreteEnd
    ? state.goal.examDate
    : configuredConcreteEnd;
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
  const diagnostics: SchedulerDiagnostics = createSchedulerDiagnostics();
  for (const material of activeMaterials) {
    if (material.preferredFinishDate && (material.preferredFinishDate < material.startDate || material.preferredFinishDate > material.targetDate)) {
      warnings.push({
        code: 'PREFERRED_FINISH_ADJUSTED',
        targetId: material.id,
        message: `${material.name}の推奨完了日が教材期間外のため、期限内の実行可能な安全完了日へ調整しました`,
      });
    }
  }
  const unscheduled: UnscheduledWorkItem[] = [];
  const assignments: Assignment[] = [];
  const deadlineReports: DeadlineReport[] = [];
  const sessionMin = state.settings.sessionMinMinutes;
  const sessionMax = state.settings.sessionMaxMinutes;

  // ---------- 教材範囲の請求(完了済み・固定・日付固定タスクが担当する単位を除外) ----------
  const preStartLockedTasks = state.tasks
    .filter((task) => task.status === 'planned'
      && effectiveLock(task) !== 'none'
      && task.scheduledDate >= currentDate
      && task.scheduledDate < today)
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.id.localeCompare(b.id));
  const dateLockedTasks = state.tasks
    .filter((task) => task.status === 'planned' && effectiveLock(task) === 'date' && task.scheduledDate >= today)
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.id.localeCompare(b.id));
  const claimedByMaterial = new Map<string, UnitRange[]>();
  const materialCountingManuals = state.tasks.filter((task) =>
    task.status === 'planned'
    && task.manualScheduling?.progressPolicy.type === 'countTowardMaterial');
  for (const task of [...fixed.valid, ...preStartLockedTasks, ...dateLockedTasks, ...materialCountingManuals, ...state.tasks.filter((item) => item.status === 'done')]) {
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
    });
  }

  const solverDays = (): SolverDayInput[] => [...calendar.values()]
    .filter((day) => day.date >= today && day.date <= feasibilityEnd)
    .map((day) => ({ date: day.date, slots: day.slots.map((slot) => ({ ...slot })), budget: day.budget }));

  const reservations = new Map<string, SlotAllocation[]>();
  const safetyFinishByMaterial = new Map<string, ISODate>();

  const cumulativeNotBehind = (actual: Map<string, SlotAllocation[]>, latest: Map<string, SlotAllocation[]>) => {
    const allDates = [...calendar.keys()].sort();
    for (const work of strictWorks) {
      let actualMinutes = 0;
      let latestMinutes = 0;
      const actualByDate = new Map<ISODate, number>();
      const latestByDate = new Map<ISODate, number>();
      for (const allocation of actual.get(work.solverItem.id) ?? []) actualByDate.set(allocation.date, (actualByDate.get(allocation.date) ?? 0) + allocation.minutes);
      for (const allocation of latest.get(work.solverItem.id) ?? []) latestByDate.set(allocation.date, (latestByDate.get(allocation.date) ?? 0) + allocation.minutes);
      for (const date of allDates) {
        actualMinutes += actualByDate.get(date) ?? 0;
        latestMinutes += latestByDate.get(date) ?? 0;
        if (actualMinutes < latestMinutes) return false;
      }
    }
    return true;
  };

  if (strictWorks.length > 0) {
    const nodeLimit = context.maxSearchNodes ?? 20000;
    const msLimit = context.maxSearchMilliseconds ?? 400;
    const searchDeadline = Date.now() + msLimit;
    let remainingNodes = nodeLimit;
    const runSolve = (items: SolverItem[], days = solverDays(), preferLate = true) => {
      const result = solveStrict(items, days, {
        maxNodes: Math.max(0, remainingNodes),
        maxMs: Math.max(0, searchDeadline - Date.now()),
        preferLate,
      });
      remainingNodes -= result.nodes;
      return result;
    };
    const baseDays = solverDays();
    const ordered = [...strictWorks].sort((a, b) =>
      countItemPlacements(a.solverItem, baseDays) - countItemPlacements(b.solverItem, baseDays)
      || compareItemsForSearch(a.solverItem, b.solverItem));
    const full = runSolve(ordered.map((work) => work.solverItem));
    let finalAllocations: Map<string, SlotAllocation[]>;
    if (full.status === 'feasible') {
      for (const work of strictWorks) work.verdict = 'feasible';
      // 最遅解は「この日までに必要な累積量」の保証線としてだけ残す。
      // 実予定は安全完了日までに均して解き、保証線を下回る解は採用しない。
      const capacityByDate = [...calendar.values()].map((day) => ({ date: day.date, minutes: day.budget }));
      const balancedDaysBase = solverDays();
      let balancedItems = ordered.map((work) => {
        const capped = withBalancedDailyUnitsCap(work, work.solverItem, balancedDaysBase);
        if (!work.material) return capped;
        const preferredFinish = computeSafetyFinishDate({
          start: work.solverItem.release,
          deadline: work.deadline,
          deadlinePolicy: 'strict',
          preferredFinishDate: work.material.preferredFinishDate,
          requiredMinutes: work.requiredMinutes,
          capacityByDate,
        });
        // 総分数だけで安全完了日を決めると、40分×21単位のような教材を
        // 2日へ840分詰め込もうとして均等解が失敗する。チャンク幅と日別上限を
        // 反映した最短実行可能日までは安全完了日を後ろへ延ばす。
        const capacityFinish = earliestCapacityFinishDate(capped, balancedDaysBase) ?? work.deadline;
        const finish = preferredFinish > capacityFinish ? preferredFinish : capacityFinish;
        safetyFinishByMaterial.set(work.material.id, finish);
        return { ...capped, deadline: finish };
      });
      balancedItems = balanceCapsForSharedDeadlines(ordered, balancedItems, balancedDaysBase);
      const totalStrictMinutes = strictWorks.reduce((sum, work) => sum + work.requiredMinutes, 0);
      const activeStrictDays = balancedDaysBase.filter((day) => day.budget > 0
        && balancedItems.some((item) => day.date >= item.release && day.date <= item.deadline)).length;
      const averageStrictMinutes = totalStrictMinutes / Math.max(1, activeStrictDays);
      const maxAvailableBudget = balancedDaysBase.reduce((max, day) => Math.max(max, day.budget), 0);
      const capCouldPossiblyFit = (cap: number) => {
        const activeDays = balancedDaysBase.filter((day) => balancedItems.some((item) =>
          day.date >= item.release && day.date <= item.deadline));
        const totalCapacity = activeDays.reduce((sum, day) => sum + Math.min(day.budget, cap), 0);
        if (totalCapacity < totalStrictMinutes) return false;
        const unitsAvailableAcross = (item: SolverItem, days: SolverDayInput[]) => {
          if (!item.splittable) {
            return days.some((day) => solverUnitsAvailableOnDay(item, day, cap) >= item.requiredUnits)
              ? item.requiredUnits
              : 0;
          }
          return days.reduce((sum, day) => sum + solverUnitsAvailableOnDay(item, day, cap), 0);
        };
        if (!balancedItems.every((item) => {
          const capacityUnits = unitsAvailableAcross(item, balancedDaysBase);
          return capacityUnits >= item.requiredUnits;
        })) return false;

        // 各期限までに「後ろの残り日では収容できない分」を全教材ぶん合算する。
        // 教材ごとの容量と総分数だけでは、単位幅が違う複数教材の組合せ損失を
        // 見抜けない。実データでは195分/日なら25分教材と40分教材を個別には
        // 収容可能に見えたが、早い期限までに必要な525分を2日390分へ置けず、
        // バックトラックが探索上限を使い切って期限直前解へ戻っていた。
        for (const cutoff of activeDays.map((day) => day.date)) {
          let mandatoryMinutesThroughCutoff = 0;
          for (const item of balancedItems) {
            const capacityAfterCutoff = unitsAvailableAcross(
              item,
              balancedDaysBase.filter((day) => day.date > cutoff),
            );
            const mandatoryUnits = Math.max(0, item.requiredUnits - capacityAfterCutoff);
            mandatoryMinutesThroughCutoff += minutesForUnits(item.minutesPerUnit, mandatoryUnits);
          }
          const capacityThroughCutoff = activeDays
            .filter((day) => day.date <= cutoff)
            .reduce((sum, day) => sum + Math.min(day.budget, cap), 0);
          if (mandatoryMinutesThroughCutoff > capacityThroughCutoff) return false;
        }
        return true;
      };
      // A raw average can be impossible after unit granularity is applied. For
      // example, 21 × 40-minute units over six days average 140 minutes, but a
      // 140-minute cap holds only three units (120 minutes) per day. The old
      // solver explored that impossible cap until its limit and then fell back
      // to the latest-deadline solution. Raise the cap only until these cheap
      // necessary capacity bounds say the balanced solve can physically fit.
      const loadStep = SCHEDULER_POLICY.balancedLoadStepMinutes;
      const initialPerDayTarget = Math.max(sessionMin, Math.ceil(averageStrictMinutes / loadStep) * loadStep);
      const perDayTarget = minimumFeasibleSteppedValue(
        initialPerDayTarget,
        maxAvailableBudget,
        loadStep,
        capCouldPossiblyFit,
      );
      const balancedDays = balancedDaysBase.map((day) => ({ ...day, budget: Math.min(day.budget, perDayTarget) }));
      let balanced = runSolve(balancedItems, balancedDays, false);
      // 大きな分割不可チャンク等で均等な総日負荷上限だけが狭すぎる場合は、
      // 教材別の分散上限を維持したまま総日負荷だけを一度緩める。
      if (balanced.status !== 'feasible') {
        const trigger = balanced.status;
        const canRelax = remainingNodes > 0 && Date.now() < searchDeadline;
        if (canRelax) balanced = runSolve(balancedItems, balancedDaysBase, false);
        diagnostics.capRelaxations.push({
          phase: 'strictDailyLoad',
          attempt: 1,
          fromCap: perDayTarget,
          toCap: maxAvailableBudget,
          trigger,
          outcome: canRelax ? balanced.status : trigger,
          termination: canRelax ? 'relaxed' : remainingNodes <= 0 ? 'nodeBudget' : 'timeBudget',
        });
      }
      if (balanced.status === 'feasible' && cumulativeNotBehind(balanced.allocations, full.allocations)) {
        finalAllocations = balanced.allocations;
      } else {
        // 安全完了日までに物理的に収まらない場合も、期限違反より実行可能性を優先する。
        const early = remainingNodes > 0 && Date.now() < searchDeadline
          ? runSolve(ordered.map((work) => work.solverItem), solverDays(), false)
          : full;
        finalAllocations = early.status === 'feasible' && cumulativeNotBehind(early.allocations, full.allocations)
          ? early.allocations
          : full.allocations;
      }
    } else if (full.status === 'indeterminate') {
      for (const work of strictWorks) work.verdict = 'indeterminate';
      finalAllocations = new Map();
    } else {
      // 全体では不可能: 実行可能な部分集合を2通りの順序で構築し、辞書式目的で良い方を採る
      const buildSubset = (order: StrictWork[]) => {
        const accepted: StrictWork[] = [];
        const verdicts = new Map<string, StrictWork['verdict']>();
        let allocations = new Map<string, SlotAllocation[]>();
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
    // ソルバーが選んだ実区間をそのまま予約し、具体期間内は同じ区間でタスク化する。
    for (const work of strictWorks) {
      if (work.verdict !== 'feasible') continue;
      const allocations = [...(finalAllocations.get(work.solverItem.id) ?? [])]
        .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start || a.end - b.end);
      const calendarSnapshot = cloneCalendar(calendar);
      const assignmentCount = assignments.length;
      const materialRanges = work.material ? rangesByMaterial.get(work.material.id)! : null;
      const rangeSnapshot = materialRanges?.map((range) => ({ ...range })) ?? null;
      let exact = allocations.length > 0;
      let allocatedTaskMinutes = 0;
      let allocatedTaskAmount = 0;
      for (const allocation of allocations) {
        const day = calendar.get(allocation.date);
        if (!day || allocation.end - allocation.start !== allocation.minutes || !reserve(day, allocation.start, allocation.end)) {
          exact = false;
          break;
        }
        if (allocation.date > concreteEnd) continue;
        if (work.material && materialRanges) {
          const irregular = allocation.units % Math.max(1, work.solverItem.unitStep) !== 0
            || allocation.units < work.solverItem.minChunkUnits;
          const range = irregular
            ? takeTailUnits(materialRanges, allocation.units)
            : takeUnits(materialRanges, allocation.units, work.material.unitStep ?? 1);
          if (!range || range.end - range.start + 1 !== allocation.units) {
            exact = false;
            break;
          }
          assignments.push(materialAssignment(work.material, allocation.date, allocation, range, 95));
        } else if (work.task) {
          const amountThrough = allocation.minutes + allocatedTaskMinutes >= work.task.estimatedMinutes
            ? work.task.amount
            : Math.round(work.task.amount * (allocatedTaskMinutes + allocation.minutes) / Math.max(1, work.task.estimatedMinutes));
          const amount = Math.max(0, amountThrough - allocatedTaskAmount);
          const explicit = taskRange(work.task);
          const range = explicit && amount > 0
            ? { start: explicit.start + allocatedTaskAmount, end: explicit.start + allocatedTaskAmount + amount - 1 }
            : undefined;
          assignments.push(taskAssignment(work.task, allocation.date, allocation, amount, range));
          allocatedTaskMinutes += allocation.minutes;
          allocatedTaskAmount += amount;
        }
      }
      if (!exact) {
        replaceCalendar(calendar, calendarSnapshot);
        assignments.splice(assignmentCount);
        if (materialRanges && rangeSnapshot) materialRanges.splice(0, materialRanges.length, ...rangeSnapshot);
        work.verdict = 'indeterminate';
        warnings.push({
          code: 'STRICT_PLACEMENT_SLIP',
          targetId: work.sourceId,
          minutes: work.requiredMinutes,
          message: '厳守作業のソルバー区間を実タスクへ変換できなかったため、期限保証から除外しました',
        });
      } else {
        reservations.set(work.workItemId, allocations.filter((allocation) => allocation.date > concreteEnd));
      }
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
        if (!state.settings.reviewRule.enabled || !material?.reviewEnabled || material.paused || material.archived) return false;
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
  const curveMaterials = activeMaterials.filter((material) =>
    material.deadlinePolicy !== 'strict' && (rangesByMaterial.get(material.id)?.length ?? 0) > 0);
  const dates: ISODate[] = [];
  for (let date = today; date <= calendarEnd; date = addDays(date, 1)) dates.push(date);
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const capBase = dates.map((date) => calendar.get(date)?.budget ?? 0);
  const baseLoadByDate = dates.map((date) => {
    const day = calendar.get(date);
    return day ? day.originalBudget - day.budget : 0;
  });

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
    cadenceDates: Set<ISODate>;
    dailyTargetMinutes: number | null;
    weeklyTargetMinutes: number | null;
    requiredUnits: number;
  }
  const capacityByDate = dates.map((date, index) => ({ date, minutes: capBase[index] }));
  const curves: CurveState[] = curveMaterials.map((material) => {
    const ranges = rangesByMaterial.get(material.id)!;
    const curveStart = material.startDate > today ? material.startDate : today;
    const requiredMinutes = minutesForUnits(material.minutesPerUnit, sumRangeLengths(ranges));
    const finish = computeSafetyFinishDate({
      start: curveStart,
      deadline: material.targetDate,
      deadlinePolicy: material.deadlinePolicy,
      preferredFinishDate: material.preferredFinishDate,
      requiredMinutes,
      capacityByDate,
    });
    const curveEnd = finish < curveStart ? curveStart : finish;
    const startIdx = dateIndex.get(curveStart) ?? 0;
    const endIdx = dateIndex.get(curveEnd) ?? dates.length - 1;
    const subject = state.subjects.find((item) => item.id === material.subjectId);
    const curveDates = dates.slice(startIdx, endIdx + 1);
    const cadenceDates = extendCadenceForCapacity(
      selectCadenceDates(material, curveDates, (date) => calendar.get(date)?.budget ?? 0),
      curveDates,
      (date) => calendar.get(date)?.budget ?? 0,
      requiredMinutes,
    );
    return {
      material,
      ranges,
      curveStart,
      curveEnd,
      windowCapacity: curveDates
        .filter((date) => cadenceDates.has(date))
        .reduce((sum, date) => sum + (calendar.get(date)?.budget ?? 0), 0),
      targetByDate: new Map<ISODate, number>(),
      cumTarget: 0,
      needMinutes: requiredMinutes,
      scheduledMinutes: 0,
      weight: 0.6 + (material.priority + (subject?.importance ?? 3) + (subject?.weakness ?? 3) + material.examRelevance) / 20,
      perDayCap: Math.min(
        material.maxMinutesPerDay ?? Number.POSITIVE_INFINITY,
        material.maxUnitsPerDay !== undefined ? minutesForUnits(material.minutesPerUnit, material.maxUnitsPerDay) : Number.POSITIVE_INFINITY,
      ),
      cadenceDates,
      dailyTargetMinutes: material.dailyTarget ? minutesForUnits(material.minutesPerUnit, material.dailyTarget) : null,
      weeklyTargetMinutes: material.weeklyTarget ? minutesForUnits(material.minutesPerUnit, material.weeklyTarget) : null,
      requiredUnits: sumRangeLengths(ranges),
    };
  });
  for (const curve of curves) safetyFinishByMaterial.set(curve.material.id, curve.curveEnd);
  const balancedLoadDays: BalancedLoadDay[] = dates.map((date, index) => ({
    date,
    availableMinutes: capBase[index],
    baseLoadMinutes: baseLoadByDate[index],
  }));
  const balancedLoadItems: BalancedLoadItem[] = curves.map((curve) => ({
    id: curve.material.id,
    release: curve.curveStart,
    deadline: curve.curveEnd,
    requiredUnits: curve.requiredUnits,
    minutesPerUnit: curve.material.minutesPerUnit,
    cadenceDates: curve.cadenceDates,
    perDayCap: curve.perDayCap,
    maxUnitsPerDay: curve.material.maxUnitsPerDay,
    splittable: curve.material.splittable !== false,
  }));
  const balancedLoadItemById = new Map(balancedLoadItems.map((item) => [item.id, item]));
  const theoreticalNormalLoadCap = minimumBalancedDailyLoadCap(balancedLoadItems, balancedLoadDays);
  // 異なる単位幅(20/25/30/40/50/60/70分など)を同じ日に詰めると、理論上限
  // ぴったりでは最後の1単位が入らず、教材ごとの小さな負債が安全完了日に残る。
  // 最大1単位ぶんだけ詰合せ余白を持たせ、未配置や予備日への一括移動を防ぐ。
  const packingHeadroom = Math.min(
    sessionMax,
    Math.ceil(Math.max(0, ...curves.map((curve) => curve.material.minutesPerUnit)) / 5) * 5,
  );
  const maximumNormalLoad = balancedLoadDays.reduce((max, day) => Math.max(max, day.baseLoadMinutes + day.availableMinutes), 0);
  const normalLoadCap = Math.min(maximumNormalLoad, theoreticalNormalLoadCap + packingHeadroom);
  const normalCapacityByDate = balancedLoadDays.map((day) => normalMinutesAtLoadCap(day, normalLoadCap));
  const progressDeficits: ProgressDeficit[] = [];
  for (const curve of curves) {
    if (curve.needMinutes > 0 && curve.windowCapacity <= 0) {
      warnings.push({ code: 'NO_ELIGIBLE_CAPACITY', targetId: curve.material.id, message: `${curve.material.name}は推奨完了日までに利用可能容量がありません` });
    }
  }
  // 日別容量を必要シェアで正規化しながら累積目標を作る
  for (let i = 0; i < dates.length; i += 1) {
    const date = dates[i];
    const capacity = normalCapacityByDate[i];
    const active = curves.filter((curve) => curve.needMinutes > 0
      && date >= curve.curveStart && date <= curve.curveEnd && curve.cadenceDates.has(date));
    if (active.length === 0 || capacity <= 0) {
      for (const curve of active) curve.targetByDate.set(date, curve.cumTarget);
      continue;
    }
    const rated = active.map((curve) => {
      const endIdx = dateIndex.get(curve.curveEnd) ?? dates.length - 1;
      const remainingWindow = Math.max(1, dates.slice(i, endIdx + 1)
        .filter((candidate) => curve.cadenceDates.has(candidate))
        .reduce((sum, candidate) => sum + normalCapacityByDate[dateIndex.get(candidate) ?? 0], 0));
      const weeklyDays = dates.filter((candidate) => mondayKey(candidate) === mondayKey(date) && curve.cadenceDates.has(candidate)).length;
      const preferredMinutes = Math.max(
        curve.dailyTargetMinutes ?? 0,
        curve.weeklyTargetMinutes === null ? 0 : curve.weeklyTargetMinutes / Math.max(1, weeklyDays),
      );
      // 目標量は上限でなく通常時の希望ペース。期限に必要なrateの方が強い。
      return { curve, rate: Math.min(1, Math.max(curve.needMinutes / remainingWindow, preferredMinutes / Math.max(1, capacity))) };
    });
    const totalRate = rated.reduce((sum, item) => sum + item.rate, 0);
    const totalWeighted = rated.reduce((sum, item) => sum + item.rate * item.curve.weight, 0);
    for (const { curve, rate } of rated) {
      const share = totalRate > 1 ? (rate * curve.weight) / requirePositiveSchedulerValue(totalWeighted, 'totalWeighted') : rate;
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

  // strict作業は上で実区間を消費済み。ここでは残り容量へ通常教材だけを配分する。
  for (let dateIdx = 0; dateIdx < dates.length && dates[dateIdx] <= concreteEnd; dateIdx += 1) {
    const date = dates[dateIdx];
    const targetTotal = curves.reduce((sum, curve) => sum + curveTargetAt(curve, date), 0);
    const scheduledBeforeDate = curves.reduce((sum, curve) => sum + curve.scheduledMinutes, 0);
    const dailyLimit = normalCapacityByDate[dateIdx];
    const dailyGoal = Math.min(dailyLimit, Math.max(0, Math.ceil(targetTotal - scheduledBeforeDate)));
    const dailyPackingCeiling = Math.min(dailyLimit, dailyGoal + packingHeadroom);
    let placedToday = 0;
    let previousMaterialId: string | null = null;
    while (placedToday < dailyLimit) {
      const candidates = curves
        .filter((curve) => curve.ranges.length > 0
          && date >= curve.curveStart && date <= curve.curveEnd && curve.cadenceDates.has(date))
        .map((curve) => {
          const item = balancedLoadItemById.get(curve.material.id)!;
          const remainingUnits = sumRangeLengths(curve.ranges);
          const futureUnits = unitsAvailableAcrossBalancedDays(
            item,
            balancedLoadDays.filter((day) => day.date > date),
            normalLoadCap,
          );
          return {
            curve,
            debt: Math.max(0, curveTargetAt(curve, date) - curve.scheduledMinutes),
            debtUnits: Math.max(0, curveTargetAt(curve, date) - curve.scheduledMinutes)
              / requirePositiveSchedulerValue(curve.material.minutesPerUnit, `material:${curve.material.id}.minutesPerUnit`),
            mandatoryUnits: Math.max(0, remainingUnits - futureUnits),
            slackUnits: futureUnits - remainingUnits,
            repeatsPrevious: curve.material.id === previousMaterialId ? 1 : 0,
          };
        })
        .filter((candidate) => candidate.debt > 0 || candidate.mandatoryUnits > 0)
        .sort((a, b) => b.mandatoryUnits - a.mandatoryUnits
          || a.repeatsPrevious - b.repeatsPrevious
          || b.debtUnits - a.debtUnits
          || b.debt - a.debt
          || a.slackUnits - b.slackUnits
          || a.curve.curveEnd.localeCompare(b.curve.curveEnd)
          || b.curve.material.priority - a.curve.material.priority
          || a.curve.material.id.localeCompare(b.curve.material.id));
      if (candidates.length === 0) break;
      let placedCandidate = false;
      for (const candidate of candidates) {
        const { curve } = candidate;
        const material = curve.material;
        const remainingUnits = sumRangeLengths(curve.ranges);
        const remainingGoal = Math.max(0, (candidate.mandatoryUnits > 0 ? dailyLimit : dailyPackingCeiling) - placedToday);
        const unitsByGoal = Math.floor(remainingGoal / requirePositiveSchedulerValue(material.minutesPerUnit, `material:${material.id}.minutesPerUnit`));
        const unitStep = material.unitStep ?? 1;
        const oneChunkUnits = material.maximumChunkUnits
          ?? Math.max(unitStep, Math.floor(sessionMax / requirePositiveSchedulerValue(material.minutesPerUnit, `material:${material.id}.minutesPerUnit`)));
        const wantedUnits = Math.min(
          remainingUnits,
          unitsByGoal,
          Math.max(candidate.mandatoryUnits, Math.ceil(candidate.debt / material.minutesPerUnit)),
          material.splittable === false ? remainingUnits : oneChunkUnits,
        );
        if (wantedUnits <= 0) continue;
        const placed = allocateMaterial(material, curve.ranges, calendar, date, date, wantedUnits, 70, sessionMin, sessionMax, assignments, fixed.valid);
        if (placed.length === 0) continue;
        const placedMinutes = placed.reduce((sum, item) => sum + item.end - item.start, 0);
        assignments.push(...placed);
        curve.scheduledMinutes += placedMinutes;
        placedToday += placedMinutes;
        previousMaterialId = material.id;
        placedCandidate = true;
        break;
      }
      if (!placedCandidate) break;
    }
  }

  // 安全完了日は平準化目標であって、未配置を作るための強制期限ではない。
  // 単位端数や共有容量の競合で残った分は、まず同じ日負荷上限を守りながら
  // 教材期限までの予備日へ流し、それでも足りない場合だけ物理容量を使う。
  for (const curve of [...curves].sort((a, b) => a.material.targetDate.localeCompare(b.material.targetDate)
    || b.material.priority - a.material.priority || a.material.id.localeCompare(b.material.id))) {
    if (curve.ranges.length === 0 || curve.curveEnd >= curve.material.targetDate) continue;
    const recoveryStart = addDays(curve.curveEnd, 1);
    const beforeRecovery = sumRangeLengths(curve.ranges);
    for (let date = recoveryStart; date <= curve.material.targetDate && curve.ranges.length > 0; date = addDays(date, 1)) {
      const day = calendar.get(date);
      if (!day) continue;
      const currentLoad = day.originalBudget - day.budget;
      const smoothMinutes = Math.max(0, Math.min(day.budget, normalLoadCap - currentLoad));
      const wantedUnits = Math.floor(smoothMinutes / requirePositiveSchedulerValue(curve.material.minutesPerUnit, `material:${curve.material.id}.minutesPerUnit`));
      if (wantedUnits <= 0) continue;
      const placed = allocateMaterial(curve.material, curve.ranges, calendar, date, date, wantedUnits, 65, sessionMin, sessionMax, assignments, fixed.valid);
      const placedMinutes = placed.reduce((sum, item) => sum + item.end - item.start, 0);
      assignments.push(...placed);
      curve.scheduledMinutes += placedMinutes;
    }
    for (let date = recoveryStart; date <= curve.material.targetDate && curve.ranges.length > 0; date = addDays(date, 1)) {
      const placed = allocateMaterial(curve.material, curve.ranges, calendar, date, date, Number.POSITIVE_INFINITY, 65, sessionMin, sessionMax, assignments, fixed.valid);
      const placedMinutes = placed.reduce((sum, item) => sum + item.end - item.start, 0);
      assignments.push(...placed);
      curve.scheduledMinutes += placedMinutes;
    }
    const recoveredUnits = beforeRecovery - sumRangeLengths(curve.ranges);
    if (recoveredUnits > 0) warnings.push({
      code: 'SAFETY_BUFFER_USED',
      targetId: curve.material.id,
      minutes: minutesForUnits(curve.material.minutesPerUnit, recoveredUnits),
      message: `${curve.material.name}は未配置を避けるため、予備期間の一部へ配置しました`,
    });
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
    const reservedLeft = (reservations.get(work.workItemId) ?? [])
      .filter((entry) => entry.date <= work.deadline)
      .reduce((sum, entry) => sum + entry.minutes, 0);
    if (work.verdict === 'infeasible') {
      // 全ロールバック済み: 採用された配置は0分なので不足は全量
      strictInfeasibleMinutes += work.requiredMinutes;
      unscheduled.push({ workItemId: work.workItemId, sourceId: work.sourceId, minutes: work.requiredMinutes, reason: '厳守期限までの区間容量またはチャンク条件が不足しています' });
      deadlineReports.push({ workItemId: work.workItemId, policy: 'strict', deadline: work.deadline, feasible: false, scheduledMinutes: 0, requiredMinutes: work.requiredMinutes, shortageMinutes: work.requiredMinutes, overdueDays: 0 });
    } else if (work.verdict === 'indeterminate') {
      const shortage = Math.max(0, work.requiredMinutes - placedWithinDeadline);
      strictIndeterminateMinutes += shortage;
      unscheduled.push({ workItemId: work.workItemId, sourceId: work.sourceId, minutes: shortage, reason: '探索上限または実区間変換の失敗により配置可能性を確定できませんでした' });
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
    ...computeLoadBalanceMetrics(state, scheduledTasks, safetyFinishByMaterial),
  };
  diagnostics.unscheduledReasons = unscheduled.map((item) => ({
    workItemId: item.workItemId,
    code: classifyUnscheduledReason(item),
    detail: item.reason,
  }));
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
    diagnostics,
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

/**
 * 期限・固定条件を満たした候補同士だけを比較するための負荷指標。
 * ここでは重み付き合計にせず、compareObjectivesの後半で辞書式に扱う。
 */
export function computeLoadBalanceMetrics(
  state: AppState,
  tasks: StudyTask[],
  safetyFinishByMaterial: ReadonlyMap<string, ISODate> = new Map(),
): Pick<ObjectiveReport,
  'maxDailyMinutes' | 'dailyLoadVariance' | 'adjacentDayDifference' | 'consecutiveHeavyDays'
  | 'subjectConcentration' | 'materialConcentration' | 'cadenceViolations'
  | 'dailyTargetDeviation' | 'weeklyTargetDeviation' | 'safetyBufferViolationMinutes'> {
  const planned = tasks.filter((task) => task.status === 'planned');
  const scheduledDates = [...new Set(planned.map((task) => task.scheduledDate))].sort();
const dates: ISODate[] = [];
if (scheduledDates.length > 0) {
  for (let date = scheduledDates[0]; date <= scheduledDates[scheduledDates.length - 1]; date = addDays(date, 1)) {
    dates.push(date);
  }
}
  const daily = new Map<ISODate, number>();
  const byDaySubject = new Map<ISODate, Map<string, number>>();
  const byDayMaterial = new Map<ISODate, Map<string, number>>();
  const byMaterialDate = new Map<string, Map<ISODate, number>>();
  for (const task of planned) {
    daily.set(task.scheduledDate, (daily.get(task.scheduledDate) ?? 0) + task.estimatedMinutes);
    const subjects = byDaySubject.get(task.scheduledDate) ?? new Map<string, number>();
    subjects.set(task.subjectId, (subjects.get(task.subjectId) ?? 0) + task.estimatedMinutes);
    byDaySubject.set(task.scheduledDate, subjects);
    if (task.materialId) {
      const materials = byDayMaterial.get(task.scheduledDate) ?? new Map<string, number>();
      materials.set(task.materialId, (materials.get(task.materialId) ?? 0) + task.estimatedMinutes);
      byDayMaterial.set(task.scheduledDate, materials);
      const materialDays = byMaterialDate.get(task.materialId) ?? new Map<ISODate, number>();
      materialDays.set(task.scheduledDate, (materialDays.get(task.scheduledDate) ?? 0) + task.estimatedMinutes);
      byMaterialDate.set(task.materialId, materialDays);
    }
  }
  const loads = dates.map((date) => daily.get(date) ?? 0);
  const average = loads.length === 0 ? 0 : loads.reduce((sum, value) => sum + value, 0) / loads.length;
  const dailyLoadVariance = loads.length === 0 ? 0 : Math.round(loads.reduce((sum, value) => sum + (value - average) ** 2, 0) / loads.length);
  const adjacentDayDifference = loads.slice(1).reduce((sum, value, index) => sum + Math.abs(value - loads[index]), 0);
  let run = 0;
  let consecutiveHeavyDays = 0;
  const heavyThreshold = Math.max(90, average * 1.25);
  for (const load of loads) {
    run = load >= heavyThreshold ? run + 1 : 0;
    consecutiveHeavyDays = Math.max(consecutiveHeavyDays, run);
  }
  const concentration = (source: Map<ISODate, Map<string, number>>) => [...source.values()].reduce((sum, values) => {
    const total = [...values.values()].reduce((inner, value) => inner + value, 0);
    const largest = Math.max(0, ...values.values());
    return sum + Math.max(0, largest * 2 - total);
  }, 0);
  let cadenceViolations = 0;
  let dailyTargetDeviation = 0;
  let weeklyTargetDeviation = 0;
  let safetyBufferViolationMinutes = 0;
  for (const material of state.materials) {
    const byDate = byMaterialDate.get(material.id) ?? new Map<ISODate, number>();
    const sessions = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
    const cadence = material.preferredCadence ?? { type: 'auto' as const };
    if (cadence.type === 'daily') {
      // daily指定で同じ日に複数チャンクへ偏った分だけを違反として扱う。
      const taskCount = planned.filter((task) => task.materialId === material.id).length;
      cadenceViolations += Math.max(0, taskCount - sessions.length);
    } else if (cadence.type === 'timesPerWeek') {
      const weeks = new Map<ISODate, number>();
      for (const [date] of sessions) weeks.set(mondayKey(date), (weeks.get(mondayKey(date)) ?? 0) + 1);
      for (const count of weeks.values()) cadenceViolations += Math.max(0, count - cadence.count);
    }
    const dailyTarget = material.dailyTarget ? minutesForUnits(material.minutesPerUnit, material.dailyTarget) : null;
    if (dailyTarget !== null) dailyTargetDeviation += sessions.reduce((sum, [, minutes]) => sum + Math.abs(minutes - dailyTarget), 0);
    const weeklyTarget = material.weeklyTarget ? minutesForUnits(material.minutesPerUnit, material.weeklyTarget) : null;
    if (weeklyTarget !== null) {
      const weeks = new Map<ISODate, number>();
      for (const [date, minutes] of sessions) weeks.set(mondayKey(date), (weeks.get(mondayKey(date)) ?? 0) + minutes);
      for (const minutes of weeks.values()) weeklyTargetDeviation += Math.abs(minutes - weeklyTarget);
    }
    const safetyFinish = safetyFinishByMaterial.get(material.id);
    if (safetyFinish) safetyBufferViolationMinutes += sessions
      .filter(([date]) => date > safetyFinish && date <= material.targetDate)
      .reduce((sum, [, minutes]) => sum + minutes, 0);
  }
  return {
    maxDailyMinutes: Math.max(0, ...loads),
    dailyLoadVariance,
    adjacentDayDifference,
    consecutiveHeavyDays,
    subjectConcentration: concentration(byDaySubject),
    materialConcentration: concentration(byDayMaterial),
    cadenceViolations,
    dailyTargetDeviation,
    weeklyTargetDeviation,
    safetyBufferViolationMinutes,
  };
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
  const orderedAutoTasksByMaterial = new Map<string, { task: StudyTask; range: UnitRange }[]>();
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
      const isReview = task.type === 'review';
      if (task.scheduledDate < material.startDate) errors.push(issue(task.id, 'scheduledDate', task.scheduledDate, '教材開始日前です', '開始日以降へ配置してください'));
      if (material.deadlinePolicy === 'strict' && task.scheduledDate > material.targetDate) errors.push(issue(task.id, 'scheduledDate', task.scheduledDate, '厳守期限後です', '期限以前へ配置してください'));
      if (!isReview && (material.paused || material.archived)) errors.push(issue(task.id, 'materialId', material.id, '停止中またはアーカイブ済み教材です', '配置対象から除外してください'));
      const range = taskRange(task);
      if (range && !isReview) {
        rangesByMaterial.set(material.id, [...(rangesByMaterial.get(material.id) ?? []), range]);
        if (material.deadlinePolicy === 'strict'
          && task.sourceType === 'material'
          && task.generatedBy === 'auto'
          && effectiveLock(task) === 'none') {
          orderedAutoTasksByMaterial.set(material.id, [
            ...(orderedAutoTasksByMaterial.get(material.id) ?? []),
            { task, range },
          ]);
        }
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
  for (const [materialId, entries] of orderedAutoTasksByMaterial) {
    const sorted = [...entries].sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end || a.task.id.localeCompare(b.task.id));
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1].task;
      const current = sorted[index].task;
      const previousPosition = `${previous.scheduledDate}T${previous.scheduledStart ?? '00:00'}`;
      const currentPosition = `${current.scheduledDate}T${current.scheduledStart ?? '00:00'}`;
      if (currentPosition < previousPosition) {
        errors.push(issue(
          current.id,
          'materialRangeOrder',
          { previous: sorted[index - 1].range, current: sorted[index].range },
          '教材範囲の順序と実行日時が逆転しています',
          `${materialId}の小さい範囲から順に配置してください`,
        ));
      }
    }
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
