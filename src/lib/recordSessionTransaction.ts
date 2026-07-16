import type { AppState, ISODate } from '../types';
import { appReducer, type Action } from '../state/AppContext';

type SessionMutationAction = Extract<Action, { type: 'RECORD_SESSION' | 'UPDATE_SESSION' }>;

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
  const recorded = appReducer(state, action);
  if (recorded === state) return state;

  const { input } = action;
  const hasTaskReference = Boolean(input.taskId || input.taskLocator?.sourceId);
  if (!input.materialId || hasTaskReference) return recorded;

  return appReducer(recorded, {
    type: 'RESCHEDULE_FROM',
    fromDate: replanFrom,
    reason: '自由記録の教材進捗反映',
  });
}
