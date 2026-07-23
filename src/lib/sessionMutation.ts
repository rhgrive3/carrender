import type { AppState, ISODate, Material, StudySession, StudyTask, UnitRange } from '../types';
import { generateReviewTasks } from './review';
import {
  normalizeUnitRanges,
  remainingUnitRanges,
  sumRangeLengths,
  updateMinutesPerUnitEstimate,
} from './scheduler';
import { revertSessionEffects } from './sessionEffects';
import { addDays, genId, hmToMinutes, localDateTimeToISOString, minutesToHM, today } from './date';

export interface SessionInput {
  taskId: string | null;
  subjectId: string;
  materialId: string | null;
  minutes: number;
  amountDone: number;
  focus: 1 | 2 | 3 | 4 | 5 | null;
  memo: string;
  source: 'timer' | 'manual';
  rangeLabel: string;
  completedTask: boolean;
  date?: ISODate;
  startTime?: string;
  taskLocator?: { sourceId?: string; range?: UnitRange; type?: StudyTask['type'] };
}

export type SessionMutationAction =
  | { type: 'RECORD_SESSION'; input: SessionInput }
  | { type: 'UPDATE_SESSION'; sessionId: string; input: SessionInput }
  | { type: 'DELETE_SESSION'; sessionId: string };

export interface PreparedSessionMutation {
  state: AppState;
  replanFrom: ISODate;
  reason: string;
  clearLastRescheduleOnSuccess: boolean;
}

function takeFirstRanges(ranges: UnitRange[], amount: number): UnitRange[] {
  const result: UnitRange[] = [];
  let left = Math.max(0, amount);
  for (const range of ranges) {
    if (left <= 0) break;
    const take = Math.min(left, range.end - range.start + 1);
    result.push({ start: range.start, end: range.start + take - 1 });
    left -= take;
  }
  return result;
}

function intersectRanges(ranges: UnitRange[], limit: UnitRange): UnitRange[] {
  return ranges.flatMap((range) => {
    const start = Math.max(range.start, limit.start);
    const end = Math.min(range.end, limit.end);
    return start <= end ? [{ start, end }] : [];
  });
}

/** 進捗量の編集時も既存の飛び飛び範囲を保ち、増減分だけを調整する。 */
export function adjustCompletedRanges(
  totalAmount: number,
  ranges: UnitRange[],
  requestedDoneAmount: number,
): UnitRange[] {
  const total = Math.max(0, Math.floor(totalAmount));
  const desired = Math.max(0, Math.min(total, Math.floor(requestedDoneAmount)));
  let adjusted = normalizeUnitRanges(
    ranges.flatMap((range) => {
      const start = Math.max(1, Math.floor(range.start));
      const end = Math.min(total, Math.floor(range.end));
      return start <= end ? [{ start, end }] : [];
    }),
    total,
  );
  const current = sumRangeLengths(adjusted);
  if (desired > current) {
    const additions = takeFirstRanges(remainingUnitRanges(total, adjusted), desired - current);
    return normalizeUnitRanges([...adjusted, ...additions], total);
  }
  let remove = current - desired;
  if (remove <= 0) return adjusted;
  adjusted = adjusted.map((range) => ({ ...range }));
  for (let index = adjusted.length - 1; index >= 0 && remove > 0; index -= 1) {
    const range = adjusted[index];
    const length = range.end - range.start + 1;
    if (remove >= length) {
      adjusted.splice(index, 1);
      remove -= length;
    } else {
      range.end -= remove;
      remove = 0;
    }
  }
  return adjusted;
}

/** タイマー開始後の再計算でIDが変わっても、同一の教材範囲・作業系列へ記録する。 */
function findCurrentTask(
  state: AppState,
  input: Pick<SessionInput, 'taskId' | 'taskLocator' | 'materialId'>,
): StudyTask | undefined {
  const exact = input.taskId ? state.tasks.find((item) => item.id === input.taskId) : undefined;
  if (exact) return exact;
  const locator = input.taskLocator;
  if (!locator?.sourceId) return undefined;
  return state.tasks.find((task) => {
    if (task.status === 'done' || task.sourceId !== locator.sourceId || task.materialId !== input.materialId) return false;
    if (locator.type && task.type !== locator.type) return false;
    if (!locator.range) return true;
    const range = task.materialRange
      ?? (Number.isFinite(task.rangeStart) && Number.isFinite(task.rangeEnd)
        ? { start: task.rangeStart!, end: task.rangeEnd! }
        : undefined);
    return range?.start === locator.range.start && range.end === locator.range.end;
  });
}

/** 入力値を、対象教材・対象タスクで実際に完了可能な量へ正規化する。 */
export function resolveSessionProgress(state: AppState, input: SessionInput) {
  const requested = Math.max(0, Math.floor(Number.isFinite(input.amountDone) ? input.amountDone : 0));
  const material = input.materialId ? state.materials.find((item) => item.id === input.materialId) : undefined;
  if (!material) return { amountDone: requested, addedRanges: [] as UnitRange[] };
  const completed = normalizeUnitRanges(
    material.completedRanges ?? (material.doneAmount > 0 ? [{ start: 1, end: material.doneAmount }] : []),
    material.totalAmount,
  );
  const task = findCurrentTask(state, input);
  const explicit = task?.materialRange
    ?? (task?.rangeStart !== null && task?.rangeStart !== undefined && task.rangeEnd !== null
      ? { start: task.rangeStart, end: task.rangeEnd }
      : undefined);
  let eligible = remainingUnitRanges(material.totalAmount, completed);
  if (explicit) eligible = intersectRanges(eligible, explicit);
  let remaining = sumRangeLengths(eligible);
  if (task && !explicit) remaining = Math.min(remaining, Math.max(0, task.amount));
  const amountDone = Math.min(input.completedTask && task ? remaining : requested, remaining);
  return { amountDone, addedRanges: takeFirstRanges(eligible, amountDone) };
}

function shrinkTaskAfterProgress(task: StudyTask, material: Material | undefined, completedRanges: UnitRange[]) {
  const explicit = task.materialRange
    ?? (task.rangeStart !== null && task.rangeStart !== undefined && task.rangeEnd !== null && task.rangeEnd !== undefined
      ? { start: task.rangeStart, end: task.rangeEnd }
      : undefined);
  const originalAmount = Math.max(1, task.amount);
  const minutesPerAmount = task.estimatedMinutes / originalAmount;
  const now = new Date().toISOString();
  if (!material || !explicit) {
    const completed = Math.min(task.amount, sumRangeLengths(completedRanges));
    const amount = Math.max(0, task.amount - completed);
    if (amount <= 0) return [{ ...task, status: 'done' as const, completedAt: now }];
    return [{
      ...task,
      amount,
      estimatedMinutes: Math.max(1, Math.round(amount * minutesPerAmount)),
      scheduledEnd: task.scheduledStart
        ? minutesToHM(hmToMinutes(task.scheduledStart) + Math.max(1, Math.round(amount * minutesPerAmount)))
        : task.scheduledEnd,
      updatedAt: now,
    }];
  }
  const remaining = intersectRanges(remainingUnitRanges(material.totalAmount, completedRanges), explicit);
  if (remaining.length === 0) return [{ ...task, status: 'done' as const, completedAt: now }];
  let cursor = task.scheduledStart ? hmToMinutes(task.scheduledStart) : null;
  return remaining.map((range, index) => {
    const amount = range.end - range.start + 1;
    const estimatedMinutes = Math.max(1, Math.round(amount * minutesPerAmount));
    const scheduledStart = cursor === null ? task.scheduledStart : minutesToHM(cursor);
    const scheduledEnd = cursor === null ? task.scheduledEnd : minutesToHM(cursor + estimatedMinutes);
    if (cursor !== null) cursor += estimatedMinutes;
    return {
      ...task,
      id: index === 0 ? task.id : `${task.id}_remaining_${range.start}_${range.end}`,
      rangeStart: range.start,
      rangeEnd: range.end,
      materialRange: range,
      rangeLabel: range.start === range.end ? `${range.start}` : `${range.start}〜${range.end}`,
      amount,
      estimatedMinutes,
      scheduledStart,
      scheduledEnd,
      status: 'planned' as const,
      completedAt: null,
      updatedAt: now,
    };
  });
}

function commitRecordSession(state: AppState, input: SessionInput, sessionId = genId('sess')): {
  state: AppState;
  currentTask: StudyTask | undefined;
  newReviews: StudyTask[];
} {
  const currentDate = today();
  const progress = resolveSessionProgress(state, input);
  const currentTask = findCurrentTask(state, input);
  const now = new Date().toISOString();
  let materials = state.materials;
  if (input.materialId && progress.amountDone > 0) {
    materials = materials.map((material) => {
      if (material.id !== input.materialId) return material;
      const completed = material.completedRanges
        ?? (material.doneAmount > 0 ? [{ start: 1, end: material.doneAmount }] : []);
      const merged = normalizeUnitRanges([...completed, ...progress.addedRanges], material.totalAmount);
      return { ...material, completedRanges: merged, doneAmount: sumRangeLengths(merged) };
    });
  }
  let tasks = state.tasks;
  let newReviews: StudyTask[] = [];
  let replacementTaskIds: string[] = [];
  if (currentTask && input.completedTask && currentTask.status !== 'done') {
    tasks = tasks.map((task) => task.id === currentTask.id
      ? { ...task, status: 'done' as const, completedAt: now }
      : task);
    newReviews = generateReviewTasks({ ...state, materials }, currentTask, input.date ?? currentDate);
  } else if (currentTask && progress.amountDone > 0 && currentTask.status !== 'done') {
    const material = currentTask.materialId
      ? materials.find((item) => item.id === currentTask.materialId)
      : undefined;
    const completedRanges = material?.completedRanges ?? [];
    const replacements = shrinkTaskAfterProgress(
      currentTask,
      material,
      progress.addedRanges.length > 0 ? completedRanges : [{ start: 1, end: progress.amountDone }],
    );
    replacementTaskIds = replacements.map((task) => task.id);
    tasks = tasks.flatMap((task) => task.id === currentTask.id ? replacements : [task]);
  }
  const session: StudySession = {
    id: sessionId,
    taskId: currentTask?.id ?? input.taskId,
    subjectId: input.subjectId,
    materialId: input.materialId,
    date: input.date ?? currentDate,
    startedAt: input.date && input.startTime
      ? localDateTimeToISOString(input.date, input.startTime)
      : now,
    minutes: input.minutes,
    amountDone: progress.amountDone,
    rangeLabel: input.rangeLabel,
    focus: input.focus,
    memo: input.memo,
    source: input.source,
    progressRangesAdded: progress.addedRanges,
    taskSnapshotBefore: currentTask ? { ...currentTask } : undefined,
    generatedReviewTaskIds: newReviews.map((task) => task.id),
    replacementTaskIds,
    completedTask: Boolean(currentTask && input.completedTask),
    updatedAt: now,
  };
  const sessions = [...state.sessions, session];
  materials = materials.map((material) => {
    if (material.id !== input.materialId) return material;
    const estimate = updateMinutesPerUnitEstimate(
      material,
      sessions,
      state.settings.estimateAlpha ?? 0.2,
    );
    return {
      ...material,
      minutesPerUnit: estimate.appliedEstimate,
      estimatedMinutesPerUnit: estimate.suggestedEstimate ?? material.estimatedMinutesPerUnit,
    };
  });
  return {
    state: { ...state, materials, tasks: [...tasks, ...newReviews], sessions },
    currentTask,
    newReviews,
  };
}

function taskRange(task: StudyTask): UnitRange | undefined {
  return task.materialRange
    ?? (task.rangeStart !== null && task.rangeStart !== undefined && task.rangeEnd !== null && task.rangeEnd !== undefined
      ? { start: task.rangeStart, end: task.rangeEnd }
      : undefined);
}

function sameLocatorTask(task: StudyTask, action: Exclude<SessionMutationAction, { type: 'DELETE_SESSION' }>): boolean {
  const locator = action.input.taskLocator;
  if (!locator?.sourceId || task.sourceId !== locator.sourceId || task.materialId !== action.input.materialId) return false;
  if (locator.type && task.type !== locator.type) return false;
  if (!locator.range) return true;
  const range = taskRange(task);
  return range?.start === locator.range.start && range.end === locator.range.end;
}

function referencedTask(state: AppState, action: Exclude<SessionMutationAction, { type: 'DELETE_SESSION' }>): StudyTask | undefined {
  const exact = action.input.taskId ? state.tasks.find((task) => task.id === action.input.taskId) : undefined;
  if (exact) return exact;
  const located = state.tasks.find((task) => task.status !== 'done' && sameLocatorTask(task, action));
  if (located) return located;
  if (action.type !== 'UPDATE_SESSION') return undefined;
  return state.sessions.find((session) => session.id === action.sessionId)?.taskSnapshotBefore;
}

function clipRanges(ranges: UnitRange[], start: number, end: number): UnitRange[] {
  return ranges.flatMap((range) => {
    const clippedStart = Math.max(range.start, start);
    const clippedEnd = Math.min(range.end, end);
    return clippedStart <= clippedEnd ? [{ start: clippedStart, end: clippedEnd }] : [];
  });
}

function extraProgressRanges(material: Material, task: StudyTask, amount: number): UnitRange[] {
  const total = Math.max(0, Math.floor(material.totalAmount));
  const completed = normalizeUnitRanges(
    material.completedRanges ?? (material.doneAmount > 0 ? [{ start: 1, end: material.doneAmount }] : []),
    total,
  );
  const remaining = remainingUnitRanges(total, completed);
  const range = taskRange(task);
  if (!range) return takeFirstRanges(remaining, amount);
  return takeFirstRanges([
    ...clipRanges(remaining, range.end + 1, total),
    ...clipRanges(remaining, 1, range.start - 1),
  ], amount);
}

function prepareTaskOverrun(
  state: AppState,
  action: Exclude<SessionMutationAction, { type: 'DELETE_SESSION' }>,
  replanFrom: ISODate,
): PreparedSessionMutation | null {
  const requestedAmount = Math.max(0, Math.floor(action.input.amountDone));
  if (!action.input.completedTask || !action.input.materialId) return null;
  const task = referencedTask(state, action);
  if (!task || task.materialId !== action.input.materialId || task.subjectId !== action.input.subjectId) return null;
  const plannedAmount = Math.max(0, Math.floor(task.amount));
  if (plannedAmount <= 0 || requestedAmount <= plannedAmount) return null;
  const previous = action.type === 'UPDATE_SESSION'
    ? state.sessions.find((session) => session.id === action.sessionId)
    : undefined;
  const baseState = previous ? revertSessionEffects(state, previous) : state;
  const committed = commitRecordSession(
    baseState,
    { ...action.input, taskId: task.id, amountDone: plannedAmount, completedTask: true },
    previous?.id,
  );
  const baseSession = committed.state.sessions.find((session) => session.id === (previous?.id ?? committed.state.sessions[committed.state.sessions.length - 1]?.id));
  const material = committed.state.materials.find((item) => item.id === action.input.materialId);
  if (!baseSession || !material) {
    return { state: committed.state, replanFrom, reason: '学習実績の反映', clearLastRescheduleOnSuccess: false };
  }
  const extraNeeded = Math.max(0, requestedAmount - baseSession.amountDone);
  const extraRanges = extraProgressRanges(material, task, extraNeeded);
  const actualExtra = sumRangeLengths(extraRanges);
  if (actualExtra <= 0) {
    return { state: committed.state, replanFrom, reason: '学習実績の反映', clearLastRescheduleOnSuccess: false };
  }
  const total = Math.max(0, Math.floor(material.totalAmount));
  const currentRanges = normalizeUnitRanges(
    material.completedRanges ?? (material.doneAmount > 0 ? [{ start: 1, end: material.doneAmount }] : []),
    total,
  );
  const completedRanges = normalizeUnitRanges([...currentRanges, ...extraRanges], total);
  const sessions = committed.state.sessions.map((session) => session.id === baseSession.id
    ? {
        ...session,
        amountDone: baseSession.amountDone + actualExtra,
        progressRangesAdded: normalizeUnitRanges([...(baseSession.progressRangesAdded ?? []), ...extraRanges], total),
        updatedAt: new Date().toISOString(),
      }
    : session);
  const materials = committed.state.materials.map((item) => {
    if (item.id !== material.id) return item;
    const progressed = { ...item, completedRanges, doneAmount: sumRangeLengths(completedRanges) };
    const estimate = updateMinutesPerUnitEstimate(
      progressed,
      sessions,
      committed.state.settings.estimateAlpha ?? 0.2,
    );
    return {
      ...progressed,
      minutesPerUnit: estimate.appliedEstimate,
      estimatedMinutesPerUnit: estimate.suggestedEstimate ?? progressed.estimatedMinutesPerUnit,
    };
  });
  return {
    state: { ...committed.state, sessions, materials },
    replanFrom,
    reason: '予定量を超えた学習実績の反映',
    clearLastRescheduleOnSuccess: false,
  };
}

function restoreDetachedCompletion(
  state: AppState,
  previousSession: StudySession,
  action: Extract<SessionMutationAction, { type: 'UPDATE_SESSION' }>,
): AppState {
  if (!previousSession.completedTask || !previousSession.taskId || !previousSession.taskSnapshotBefore) return state;
  const keepsSameTarget = action.input.subjectId === previousSession.subjectId
    && action.input.materialId === previousSession.materialId;
  const detached = !action.input.taskId && !action.input.taskLocator?.sourceId;
  const originalAmount = Math.max(0, previousSession.taskSnapshotBefore.amount);
  if (!keepsSameTarget || !detached || action.input.amountDone <= originalAmount) return state;
  const currentTask = state.tasks.find((task) => task.id === previousSession.taskId);
  const completedTask: StudyTask = {
    ...(currentTask ?? previousSession.taskSnapshotBefore),
    id: previousSession.taskId,
    status: 'done',
    completedAt: currentTask?.completedAt ?? previousSession.updatedAt ?? previousSession.startedAt,
    updatedAt: new Date().toISOString(),
  };
  const oldReviewIds = new Set(previousSession.generatedReviewTaskIds ?? []);
  const tasks = [
    ...state.tasks.filter((task) => task.id !== completedTask.id && !oldReviewIds.has(task.id)),
    completedTask,
  ];
  const withTask = { ...state, tasks };
  const reviews = generateReviewTasks(withTask, completedTask, action.input.date ?? previousSession.date);
  return {
    ...withTask,
    tasks: [...tasks, ...reviews],
    sessions: withTask.sessions.map((session) => session.id === previousSession.id
      ? {
          ...session,
          taskId: completedTask.id,
          rangeLabel: previousSession.rangeLabel,
          taskSnapshotBefore: previousSession.taskSnapshotBefore,
          generatedReviewTaskIds: reviews.map((task) => task.id),
          replacementTaskIds: [],
          completedTask: true,
          ...(previousSession.pausedMinutes !== undefined ? { pausedMinutes: previousSession.pausedMinutes } : {}),
          ...(previousSession.excludedFromEstimate !== undefined ? { excludedFromEstimate: previousSession.excludedFromEstimate } : {}),
        }
      : session),
  };
}

function preserveUpdateMetadata(previous: StudySession, before: AppState, next: AppState, input: SessionInput): AppState {
  const sessions = next.sessions.map((session) => session.id === previous.id
    ? {
        ...session,
        ...(previous.pausedMinutes !== undefined ? { pausedMinutes: previous.pausedMinutes } : {}),
        ...(previous.excludedFromEstimate !== undefined ? { excludedFromEstimate: previous.excludedFromEstimate } : {}),
      }
    : session);
  if (previous.materialId !== input.materialId
    || previous.minutes !== input.minutes
    || previous.amountDone !== input.amountDone) return { ...next, sessions };
  const estimates = new Map(before.materials.map((material) => [material.id, {
    minutesPerUnit: material.minutesPerUnit,
    estimatedMinutesPerUnit: material.estimatedMinutesPerUnit,
  }]));
  return {
    ...next,
    sessions,
    materials: next.materials.map((material) => {
      const estimate = estimates.get(material.id);
      return estimate ? { ...material, ...estimate } : material;
    }),
  };
}

export function prepareSessionMutation(
  state: AppState,
  action: SessionMutationAction,
  replanFrom: ISODate = today(),
): PreparedSessionMutation | null {
  if (action.type === 'DELETE_SESSION') {
    const previous = state.sessions.find((session) => session.id === action.sessionId);
    return previous
      ? { state: revertSessionEffects(state, previous), replanFrom, reason: '学習記録の削除', clearLastRescheduleOnSuccess: false }
      : null;
  }
  const overrun = prepareTaskOverrun(state, action, replanFrom);
  if (overrun) return overrun;
  const previous = action.type === 'UPDATE_SESSION'
    ? state.sessions.find((session) => session.id === action.sessionId)
    : undefined;
  if (action.type === 'UPDATE_SESSION' && !previous) return null;
  const base = previous ? revertSessionEffects(state, previous) : state;
  const committed = commitRecordSession(base, action.input, previous?.id);
  let next = committed.state;
  if (previous && action.type === 'UPDATE_SESSION') {
    next = restoreDetachedCompletion(next, previous, action);
    next = preserveUpdateMetadata(previous, state, next, action.input);
  }
  const hasTaskReference = Boolean(action.input.taskId || action.input.taskLocator?.sourceId);
  const tasklessMaterialRecord = Boolean(action.input.materialId && !hasTaskReference);
  const reason = tasklessMaterialRecord ? '自由記録の教材進捗反映' : '学習実績の反映';
  const planFrom = tasklessMaterialRecord ? replanFrom : addDays(today(), 1);
  const clearLastRescheduleOnSuccess = committed.newReviews.length === 0
    && !(committed.currentTask && !action.input.completedTask);
  return { state: next, replanFrom: planFrom, reason, clearLastRescheduleOnSuccess };
}
