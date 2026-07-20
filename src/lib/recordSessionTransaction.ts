import type { AppState, ISODate, Material, StudySession, StudyTask, UnitRange } from '../types';
import { appReducer, type Action } from '../state/AppContext';
import { generateReviewTasks } from './review';
import {
  normalizeUnitRanges,
  remainingUnitRanges,
  sumRangeLengths,
  updateMinutesPerUnitEstimate,
} from './scheduler';

type SessionMutationAction = Extract<Action, { type: 'RECORD_SESSION' | 'UPDATE_SESSION' }>;

interface DetachedCompletion {
  previousSession: StudySession;
  completedTask: StudyTask;
}

interface TaskOverrun {
  task: StudyTask;
  requestedAmount: number;
}

function taskRange(task: StudyTask): UnitRange | undefined {
  return task.materialRange
    ?? (task.rangeStart !== null && task.rangeStart !== undefined && task.rangeEnd !== null && task.rangeEnd !== undefined
      ? { start: task.rangeStart, end: task.rangeEnd }
      : undefined);
}

function sameLocatorTask(task: StudyTask, action: SessionMutationAction): boolean {
  const locator = action.input.taskLocator;
  if (!locator?.sourceId || task.sourceId !== locator.sourceId || task.materialId !== action.input.materialId) return false;
  if (locator.type && task.type !== locator.type) return false;
  if (!locator.range) return true;
  const range = taskRange(task);
  return range?.start === locator.range.start && range.end === locator.range.end;
}

function referencedTask(state: AppState, action: SessionMutationAction): StudyTask | undefined {
  const exact = action.input.taskId
    ? state.tasks.find((task) => task.id === action.input.taskId)
    : undefined;
  if (exact) return exact;
  const located = state.tasks.find((task) => task.status !== 'done' && sameLocatorTask(task, action));
  if (located) return located;
  if (action.type !== 'UPDATE_SESSION') return undefined;
  const previous = state.sessions.find((session) => session.id === action.sessionId);
  return previous?.taskSnapshotBefore;
}

function taskOverrunToApply(state: AppState, action: SessionMutationAction): TaskOverrun | null {
  const requestedAmount = Math.max(0, Math.floor(action.input.amountDone));
  if (!action.input.completedTask || !action.input.materialId) return null;
  const task = referencedTask(state, action);
  if (!task || task.materialId !== action.input.materialId || task.subjectId !== action.input.subjectId) return null;
  const plannedAmount = Math.max(0, Math.floor(task.amount));
  return plannedAmount > 0 && requestedAmount > plannedAmount ? { task, requestedAmount } : null;
}

function clipRanges(ranges: UnitRange[], start: number, end: number): UnitRange[] {
  return ranges.flatMap((range) => {
    const clippedStart = Math.max(range.start, start);
    const clippedEnd = Math.min(range.end, end);
    return clippedStart <= clippedEnd ? [{ start: clippedStart, end: clippedEnd }] : [];
  });
}

function takeFirstRanges(ranges: UnitRange[], amount: number): UnitRange[] {
  const result: UnitRange[] = [];
  let remaining = Math.max(0, amount);
  for (const range of ranges) {
    if (remaining <= 0) break;
    const length = range.end - range.start + 1;
    const take = Math.min(length, remaining);
    result.push({ start: range.start, end: range.start + take - 1 });
    remaining -= take;
  }
  return result;
}

/** 予定範囲の直後を優先し、なければ前方の未完了範囲へ追加実績を割り当てる。 */
function extraProgressRanges(material: Material, task: StudyTask, amount: number): UnitRange[] {
  const total = Math.max(0, Math.floor(material.totalAmount));
  const completed = normalizeUnitRanges(
    material.completedRanges ?? (material.doneAmount > 0 ? [{ start: 1, end: material.doneAmount }] : []),
    total,
  );
  const remaining = remainingUnitRanges(total, completed);
  const range = taskRange(task);
  if (!range) return takeFirstRanges(remaining, amount);
  const after = clipRanges(remaining, range.end + 1, total);
  const before = clipRanges(remaining, 1, range.start - 1);
  return takeFirstRanges([...after, ...before], amount);
}

/**
 * タイマー終了・記録編集で予定量を超えた場合、まず元タスクを通常どおり完了し、
 * 超過分だけを教材の追加実績として同じセッションへ加える。これにより完了タスクを
 * taskless記録へ変換せず、再計算後も今日のチェック表示と達成率を保持できる。
 */
function recordTaskOverrun(
  state: AppState,
  action: SessionMutationAction,
  overrun: TaskOverrun,
  replanFrom: ISODate,
): AppState {
  const plannedAmount = Math.max(1, Math.floor(overrun.task.amount));
  const baseInput = {
    ...action.input,
    taskId: overrun.task.id,
    amountDone: plannedAmount,
    completedTask: true,
  };
  const baseAction: SessionMutationAction = action.type === 'UPDATE_SESSION'
    ? { ...action, input: baseInput }
    : { ...action, input: baseInput };
  const recorded = appReducer(state, baseAction);
  if (recorded === state) return state;

  const sessionId = action.type === 'UPDATE_SESSION'
    ? action.sessionId
    : recorded.sessions.at(-1)?.id;
  const baseSession = sessionId ? recorded.sessions.find((session) => session.id === sessionId) : undefined;
  const material = recorded.materials.find((item) => item.id === action.input.materialId);
  if (!baseSession || !material) return recorded;

  const extraNeeded = Math.max(0, overrun.requestedAmount - baseSession.amountDone);
  const extraRanges = extraProgressRanges(material, overrun.task, extraNeeded);
  const actualExtra = sumRangeLengths(extraRanges);
  if (actualExtra <= 0) return recorded;

  const total = Math.max(0, Math.floor(material.totalAmount));
  const currentRanges = normalizeUnitRanges(
    material.completedRanges ?? (material.doneAmount > 0 ? [{ start: 1, end: material.doneAmount }] : []),
    total,
  );
  const completedRanges = normalizeUnitRanges([...currentRanges, ...extraRanges], total);
  const sessions = recorded.sessions.map((session) => session.id === baseSession.id
    ? {
        ...session,
        amountDone: baseSession.amountDone + actualExtra,
        progressRangesAdded: normalizeUnitRanges([...(baseSession.progressRangesAdded ?? []), ...extraRanges], total),
        updatedAt: new Date().toISOString(),
      }
    : session);
  let materials = recorded.materials.map((item) => item.id === material.id
    ? { ...item, completedRanges, doneAmount: sumRangeLengths(completedRanges) }
    : item);
  materials = materials.map((item) => {
    if (item.id !== material.id) return item;
    const estimate = updateMinutesPerUnitEstimate(item, sessions, recorded.settings.estimateAlpha ?? 0.2);
    return {
      ...item,
      minutesPerUnit: estimate.appliedEstimate,
      estimatedMinutesPerUnit: estimate.suggestedEstimate ?? item.estimatedMinutesPerUnit,
    };
  });

  return appReducer({ ...recorded, sessions, materials }, {
    type: 'RESCHEDULE_FROM',
    fromDate: replanFrom,
    reason: '予定量を超えた学習実績の反映',
  });
}

/**
 * 完了済みタスクの実績量を元の予定量より増やす旧編集経路では、進捗計算だけを
 * 教材全体へ広げるため入力上は一時的にtaskIdを外していた。
 * 旧画面・旧保存操作が残っていても完了タスクを消さないための互換処理。
 */
function detachedCompletionToPreserve(state: AppState, action: SessionMutationAction): DetachedCompletion | null {
  if (action.type !== 'UPDATE_SESSION') return null;
  const previousSession = state.sessions.find((session) => session.id === action.sessionId);
  if (!previousSession?.completedTask || !previousSession.taskId || !previousSession.taskSnapshotBefore) return null;

  const input = action.input;
  const keepsSameRecordTarget = input.subjectId === previousSession.subjectId
    && input.materialId === previousSession.materialId;
  const temporarilyDetached = !input.taskId && !input.taskLocator?.sourceId;
  const originalAmount = Math.max(0, previousSession.taskSnapshotBefore.amount);
  if (!keepsSameRecordTarget || !temporarilyDetached || input.amountDone <= originalAmount) return null;

  const currentTask = state.tasks.find((task) => task.id === previousSession.taskId);
  const source = currentTask ?? previousSession.taskSnapshotBefore;
  const completedAt = currentTask?.completedAt ?? previousSession.updatedAt ?? previousSession.startedAt;
  return {
    previousSession,
    completedTask: {
      ...source,
      id: previousSession.taskId,
      status: 'done',
      completedAt,
      updatedAt: new Date().toISOString(),
    },
  };
}

function restoreDetachedCompletion(
  recorded: AppState,
  action: SessionMutationAction,
  detached: DetachedCompletion,
): AppState {
  const oldReviewIds = new Set(detached.previousSession.generatedReviewTaskIds ?? []);
  const tasksWithoutOldEffects = recorded.tasks.filter((task) =>
    task.id !== detached.completedTask.id && !oldReviewIds.has(task.id));
  const stateWithCompletion = {
    ...recorded,
    tasks: [...tasksWithoutOldEffects, detached.completedTask],
  };
  const reviews = generateReviewTasks(
    stateWithCompletion,
    detached.completedTask,
    action.input.date ?? detached.previousSession.date,
  );
  const sessions = stateWithCompletion.sessions.map((session) => session.id === detached.previousSession.id
    ? {
        ...session,
        taskId: detached.completedTask.id,
        rangeLabel: detached.previousSession.rangeLabel,
        taskSnapshotBefore: detached.previousSession.taskSnapshotBefore,
        generatedReviewTaskIds: reviews.map((task) => task.id),
        replacementTaskIds: [],
        completedTask: true,
      }
    : session);
  return {
    ...stateWithCompletion,
    tasks: [...stateWithCompletion.tasks, ...reviews],
    sessions,
  };
}

/**
 * タスクを指定しない教材記録は「今回やった個数」を未完了範囲へ加える。
 * 通常のrecordSessionは当日の残り予定を保護して翌日から再計画するため、
 * 自由記録が当日の自動タスク範囲へ入ると、古い予定が完了済み範囲と重複する。
 * 記録を反映した状態を今日から再計画し、当日の自動タスクも残量へ更新する。
 */
export function applyRecordSessionTransaction(
  state: AppState,
  action: SessionMutationAction,
  replanFrom: ISODate,
): AppState {
  const overrun = taskOverrunToApply(state, action);
  if (overrun) return recordTaskOverrun(state, action, overrun, replanFrom);

  const detached = detachedCompletionToPreserve(state, action);
  const recordedBase = appReducer(state, action);
  if (recordedBase === state) return state;
  const recorded = detached ? restoreDetachedCompletion(recordedBase, action, detached) : recordedBase;

  const { input } = action;
  const hasTaskReference = Boolean(input.taskId || input.taskLocator?.sourceId);
  if (!input.materialId || hasTaskReference) return recorded;

  return appReducer(recorded, {
    type: 'RESCHEDULE_FROM',
    fromDate: replanFrom,
    reason: '自由記録の教材進捗反映',
  });
}
