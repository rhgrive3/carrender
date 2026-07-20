import type { AppState, ISODate, StudySession, StudyTask } from '../types';
import { appReducer, type Action } from '../state/AppContext';
import { generateReviewTasks } from './review';

type SessionMutationAction = Extract<Action, { type: 'RECORD_SESSION' | 'UPDATE_SESSION' }>;

interface DetachedCompletion {
  previousSession: StudySession;
  completedTask: StudyTask;
}

/**
 * 完了済みタスクの実績量を元の予定量より増やす編集では、進捗計算だけを
 * 教材全体へ広げるため入力上は一時的にtaskIdを外している。
 * そのまま保存すると、再計算時に「今日完了したタスク」まで履歴から消えるため、
 * 元の完了タスクと編集・削除用snapshotを復元する。
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
