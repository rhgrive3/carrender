import type {
  AppState,
  CapacityWarning,
  FixedEvent,
  ISODate,
  PlanHistoryEntry,
  RescheduleResult,
  StudyTask,
  TimeRange,
} from '../types';
import { addDays, APP_TIME_ZONE, diffDays, formatMinutes, hmToMinutes, minutesInTimeZone, minutesToHM, weekdayOf } from './date';
import { isPlacedPlanTask } from './taskFilters';
import { dateInTimeZone, mergeMinuteRanges, subtractMinuteRanges } from './schedulerV2';
import { generatePlanV2 } from './schedulerRecovery';
import { applyOneYearHistoryRetention } from './historyRetention';
import { appendPlanRevision, capturePlanRevision } from './planHistory';
export {
  normalizeUnitRanges,
  remainingUnitRanges,
  sumRangeLengths,
  updateMinutesPerUnitEstimate,
} from './schedulerV2';

// ============================================================
// 利用可能時間・固定予定
// ============================================================

interface FreeSlot {
  start: number;
  end: number;
}

interface GeneratePlanOptions {
  now?: Date;
  timezone?: string;
  generationId?: string;
}

function roundUpToStep(min: number, step: number): number {
  return Math.ceil(min / step) * step;
}

export function fixedEventsOn(state: AppState, date: ISODate): FixedEvent[] {
  const wd = weekdayOf(date);
  return state.fixedEvents.filter((e) => {
    if (e.date) return e.date === date;
    if (e.weekday !== null) {
      if (e.weekday !== wd) return false;
      if (e.startDate && date < e.startDate) return false;
      if (e.endDate && date > e.endDate) return false;
      return true;
    }
    if (e.startDate || e.endDate) {
      if (e.startDate && date < e.startDate) return false;
      if (e.endDate && date > e.endDate) return false;
      return true;
    }
    return false;
  });
}

export function dayPlanOn(state: AppState, date: ISODate) {
  return state.dayPlans.find((p) => p.date === date) ?? null;
}

function availabilityWindowsOn(state: AppState, date: ISODate): TimeRange[] {
  const override = dayPlanOn(state, date);
  if (override?.load === 'rest') return [];
  if (override?.availabilityWindows) return override.availabilityWindows;
  const wd = weekdayOf(date);
  const slot = state.availability.find((a) => a.weekday === wd);
  if (slot?.windows && slot.windows.length > 0) return slot.windows;
  if (slot && slot.minutes > 0) {
    const start = wd === 0 || wd === 6 ? hmToMinutes('09:00') : hmToMinutes('18:00');
    return [{ start: minutesToHM(start), end: minutesToHM(start + slot.minutes) }];
  }
  return [];
}

/** 区間リストからbusy区間を除いた残り */
export function subtractBusySlots(windows: FreeSlot[], busy: FreeSlot[]): FreeSlot[] {
  return subtractMinuteRanges(mergeMinuteRanges(windows), mergeMinuteRanges(busy));
}

/** 固定予定を除いた自由時間帯(分単位の区間リスト) */
export function freeSlotsOn(state: AppState, date: ISODate): FreeSlot[] {
  const events = fixedEventsOn(state, date).map((e) => ({ start: hmToMinutes(e.start), end: hmToMinutes(e.end) }));
  const baseWindows = availabilityWindowsOn(state, date)
    .map((w) => ({
      start: hmToMinutes(w.start),
      end: hmToMinutes(w.end),
    }))
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start);
  return subtractBusySlots(baseWindows, events).filter((s) => s.end > s.start);
}

export function futureFreeSlotsOn(state: AppState, date: ISODate, now: Date, timezone = APP_TIME_ZONE): FreeSlot[] {
  const slots = freeSlotsOn(state, date);
  if (date !== dateInTimeZone(now, timezone)) return slots;
  const minimumStart = roundUpToStep(minutesInTimeZone(now, timezone), 5);
  return slots.map((slot) => ({ ...slot, start: Math.max(slot.start, minimumStart) })).filter((slot) => slot.start < slot.end);
}

/** タスクが占有している時間帯(分単位の区間) */
export function taskBusySlots(tasks: StudyTask[]): FreeSlot[] {
  const out: FreeSlot[] = [];
  for (const t of tasks) {
    if (!t.scheduledStart || !t.scheduledEnd) continue;
    out.push({ start: hmToMinutes(t.scheduledStart), end: hmToMinutes(t.scheduledEnd) });
  }
  return out;
}

/** その日の勉強可能分数(曜日設定と上限でクリップ) */
export function availableMinutesOn(state: AppState, date: ISODate): number {
  const override = dayPlanOn(state, date);
  if (override?.load === 'rest') return 0;
  const wd = weekdayOf(date);
  const slot = state.availability.find((a) => a.weekday === wd);
  const windows = freeSlotsOn(state, date);
  const windowMinutes = windows.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
  // 日別例外で時間帯を上書きした日は、その時間帯こそが申告値。
  // 曜日の申告分数で頭打ちにすると「この日だけ長く勉強する」上書きが効かない。
  const declared = override?.availabilityWindows ? windowMinutes : slot ? slot.minutes : windowMinutes;
  const factor = override?.load === 'light' ? 0.6 : override?.load === 'heavy' ? 1.2 : 1;
  return Math.max(0, Math.round(Math.min(windowMinutes, declared * factor, state.settings.maxDailyMinutes)));
}

// ============================================================
// プラン生成
// ============================================================

function captureMissedPlanHistory(state: AppState, todayDate: ISODate, capturedAt: string): PlanHistoryEntry[] {
  const existing = state.planHistory ?? [];
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  for (const task of state.tasks) {
    if (task.scheduledDate >= todayDate || task.status === 'done' || task.status === 'skipped') continue;
    if (!isPlacedPlanTask(task)) continue;
    const id = `missed:${task.id}:${task.scheduledDate}`;
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      taskId: task.id,
      subjectId: task.subjectId,
      materialId: task.materialId,
      title: task.title,
      scheduledDate: task.scheduledDate,
      estimatedMinutes: task.estimatedMinutes,
      amount: task.amount,
      type: task.type,
      outcome: 'missed',
      rangeStart: task.rangeStart,
      rangeEnd: task.rangeEnd,
      materialRange: task.materialRange,
      capturedAt,
    });
  }
  return [...byId.values()].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.id.localeCompare(b.id));
}

/**
 * 既存Reducer向けアダプター。計画生成そのものはgeneratePlanV2純粋関数が担い、
 * ここでは履歴の保持と従来の再計算サマリーだけを組み立てる。
 */
export function generatePlan(
  inputState: AppState,
  fromDate: ISODate,
  reason: string,
  options: GeneratePlanOptions = {},
): { state: AppState; result: RescheduleResult } {
  const now = options.now ?? new Date();
  const generationId = options.generationId ?? `plan-${fromDate}-${now.getTime()}`;
  const timezone = options.timezone ?? APP_TIME_ZONE;
  const todayDate = dateInTimeZone(now, timezone);
  const state = applyOneYearHistoryRetention(inputState, todayDate);
  const revisionBase = state;
  const planHistory = captureMissedPlanHistory(state, todayDate, new Date(now).toISOString());
  const protectedTasks = new Map(
    state.tasks
      .filter((task) => task.status === 'planned' && task.scheduledDate >= todayDate && task.scheduledDate < fromDate)
      .map((task) => [task.id, task]),
  );
  const planningState = protectedTasks.size === 0
    ? state
    : {
        ...state,
        tasks: state.tasks.map((task) => {
          if (!protectedTasks.has(task.id)
            || task.placementLock === 'time'
            || task.manualScheduling?.placementPolicy === 'fixedTime') return task;
          return {
            ...task,
            placementLock: 'date' as const,
            scheduledStart: null,
            scheduledEnd: null,
            placementStatus: 'unscheduled' as const,
          };
        }),
      };
  const rawSchedule = generatePlanV2(planningState, {
    now,
    timezone,
    generationId,
  });
  const schedule = protectedTasks.size === 0
    ? rawSchedule
    : {
        ...rawSchedule,
        scheduledTasks: rawSchedule.scheduledTasks.map((task) => {
          const original = protectedTasks.get(task.id);
          return original ? { ...task, placementLock: original.placementLock, generatedBy: original.generatedBy } : task;
        }),
      };
  const capacity: CapacityWarning = {
    totalRemainingMinutes: schedule.capacityReport.requiredMinutes,
    totalAvailableMinutes: schedule.capacityReport.availableMinutes,
    deficitMinutes: schedule.capacityReport.requiredMinutes - schedule.capacityReport.availableMinutes,
    ok: schedule.status === 'success'
      && schedule.capacityReport.requiredMinutes <= schedule.capacityReport.availableMinutes,
  };
  const result: RescheduleResult = {
    at: schedule.generatedAt,
    reason,
    changes: schedule.unscheduledWork.slice(0, 8).map((item) => ({
      kind: 'postponed',
      taskTitle: state.materials.find((material) => material.id === item.sourceId)?.name
        ?? state.tasks.find((task) => task.id === item.sourceId)?.title
        ?? item.sourceId,
      subjectId: state.materials.find((material) => material.id === item.sourceId)?.subjectId
        ?? state.tasks.find((task) => task.id === item.sourceId)?.subjectId
        ?? '',
      detail: item.reason,
    })),
    subjectMinuteDelta: [],
    capacity,
    summaryText:
      schedule.status === 'conflict'
        ? `${reason}を反映しましたが、固定条件に${schedule.conflicts.length}件の衝突があります。`
        : schedule.status === 'infeasible'
          ? `${reason}を反映しましたが、厳守期限までに${formatMinutes(schedule.objectiveReport.unscheduledStrictMinutes)}不足しています。`
          : schedule.status === 'indeterminate'
            ? `${reason}を反映しましたが、探索上限に達したため厳守期限の実行可能性を確定できませんでした。`
            : schedule.status === 'invalidInput'
              ? `${reason}を反映できません。入力値を修正してください。`
              : schedule.status === 'partial'
                ? `${reason}を反映しました。通常・柔軟課題の一部は未配置です。`
                : `${reason}のため計画を再設計しました。`,
  };

  if (schedule.status === 'invalidInput') {
    return { state: { ...state, lastScheduleResult: schedule, lastPlanReason: reason, lastReschedule: result }, result };
  }

  const generatedIds = new Set(schedule.scheduledTasks.map((task) => task.id));
  const conflictIds = new Set(schedule.conflicts.map((conflict) => conflict.taskId));
  const unscheduledIds = new Set(schedule.unscheduledWork.filter((item) => item.workItemId.startsWith('task:')).map((item) => item.sourceId));
  const history = state.tasks.filter((task) =>
    task.status === 'done'
    || task.status === 'skipped'
    || task.scheduledDate < todayDate
    || (task.status === 'doing' && !generatedIds.has(task.id)),
  ).map((task) => task.scheduledDate < todayDate && task.status !== 'done' && task.status !== 'skipped'
    ? { ...task, status: 'postponed' as const, placementStatus: 'unscheduled' as const, scheduledStart: null, scheduledEnd: null }
    : task);
  const conflicts = state.tasks
    .filter((task) => conflictIds.has(task.id))
    .map((task) => ({ ...task, placementStatus: 'conflict' as const }));
  const unscheduledTasks = state.tasks
    .filter((task) => unscheduledIds.has(task.id) && !conflictIds.has(task.id))
    .map((task) => ({ ...task, scheduledStart: null, scheduledEnd: null, placementStatus: 'unscheduled' as const }));
  // 具体計画期間の外にある日付固定・期限固定の手動タスクは、内部の
  // feasibility calendar には存在しても scheduledTasks へ変換されない。
  // 次回の再計算まで state から消さず、そのまま保持する。
  const futureManuals = state.tasks.filter((task) =>
    task.status === 'planned'
    && task.scheduledDate > schedule.capacityReport.horizonEnd
    && Boolean(task.manualScheduling));
  const merged = [...history, ...schedule.scheduledTasks, ...conflicts, ...unscheduledTasks, ...futureManuals];
  const unique = [...new Map(merged.map((task) => [task.id, task])).values()];
  const nextState: AppState = {
    ...state,
    tasks: unique,
    planHistory,
    lastScheduleResult: schedule,
    lastPlanReason: reason,
    lastReschedule: result,
    lastPlannedDate: todayDate,
  };
  const revision = capturePlanRevision({
    before: revisionBase,
    after: nextState,
    generationId,
    reason,
    fromDate,
    createdAt: schedule.generatedAt,
  });
  return { state: appendPlanRevision(nextState, revision, now), result };
}

/** 直近14日間の科目別 予定達成率 */
export function subjectAchievementMap(state: AppState, ref: ISODate): Map<string, number> {
  const from = addDays(ref, -14);
  const planned = new Map<string, number>();
  const done = new Map<string, number>();
  for (const task of state.tasks) {
    if (task.scheduledDate < from || task.scheduledDate >= ref || !isPlacedPlanTask(task)) continue;
    planned.set(task.subjectId, (planned.get(task.subjectId) ?? 0) + task.estimatedMinutes);
    if (task.status === 'done') done.set(task.subjectId, (done.get(task.subjectId) ?? 0) + task.estimatedMinutes);
  }
  for (const entry of state.planHistory ?? []) {
    if (entry.scheduledDate < from || entry.scheduledDate >= ref) continue;
    planned.set(entry.subjectId, (planned.get(entry.subjectId) ?? 0) + entry.estimatedMinutes);
  }
  const map = new Map<string, number>();
  for (const [subjectId, minutes] of planned) {
    map.set(subjectId, minutes > 0 ? (done.get(subjectId) ?? 0) / minutes : 1);
  }
  return map;
}

// ============================================================
// キャパシティ警告
// ============================================================

export function computeCapacity(state: AppState, ref: ISODate, now = new Date()): CapacityWarning {
  const goal = state.goal;
  const examDate = goal ? goal.examDate : addDays(ref, 90);

  // 残り学習量(分): 教材残量 + 未完了の復習/手動タスク
  let remainingMinutes = 0;
  for (const m of state.materials) {
    if (m.archived || m.paused) continue;
    remainingMinutes += Math.max(0, m.totalAmount - m.doneAmount) * m.minutesPerUnit;
  }
  for (const t of state.tasks) {
    const independentManual = t.materialId === null && (t.sourceType === 'manual' || t.generatedBy === 'manual');
    if (t.status === 'planned' && (t.type !== 'new' || independentManual)) remainingMinutes += t.estimatedMinutes;
  }

  // 試験日までの利用可能分数
  let available = 0;
  let d = ref;
  const currentDate = dateInTimeZone(now, APP_TIME_ZONE);
  while (d <= examDate) {
    const dayCapacity = availableMinutesOn(state, d);
    if (d === currentDate) {
      const futureWindowMinutes = futureFreeSlotsOn(state, d, now)
        .reduce((sum, slot) => sum + Math.max(0, slot.end - slot.start), 0);
      available += Math.min(dayCapacity, futureWindowMinutes);
    } else {
      available += dayCapacity;
    }
    d = addDays(d, 1);
  }

  const deficit = remainingMinutes - available;
  return {
    totalRemainingMinutes: Math.round(remainingMinutes),
    totalAvailableMinutes: Math.round(available),
    deficitMinutes: Math.round(deficit),
    ok: deficit <= 0,
  };
}

// ============================================================
// 今日の状態判定
// ============================================================

export type DayStatus = 'ahead' | 'onTrack' | 'slightlyBehind' | 'danger';

export function computeDayStatus(state: AppState, date: ISODate, capacity?: CapacityWarning): DayStatus {
  const cap = capacity ?? computeCapacity(state, date);
  if (!cap.ok && cap.deficitMinutes > 600) return 'danger';

  const overdueTasks = state.tasks.filter(
    (t) => t.status === 'planned' && t.scheduledDate < date,
  ).length;
  const behindMaterials = state.materials.filter((m) => {
    if (m.archived || m.paused || m.totalAmount === 0) return false;
    const total = Math.max(1, diffDays(m.startDate ?? m.createdAt.slice(0, 10), m.targetDate));
    const elapsed = Math.max(0, diffDays(m.startDate ?? m.createdAt.slice(0, 10), date));
    return m.doneAmount / m.totalAmount < Math.min(1, elapsed / total) - 0.1;
  }).length;

  if (!cap.ok || overdueTasks >= 5 || behindMaterials >= 3) return 'danger';
  if (overdueTasks >= 2 || behindMaterials >= 1) return 'slightlyBehind';
  const achievement = subjectAchievementMap(state, date);
  const vals = [...achievement.values()];
  const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 1;
  if (avg >= 0.9 && cap.deficitMinutes < -600) return 'ahead';
  return 'onTrack';
}
