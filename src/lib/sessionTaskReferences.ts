import type { AppState } from '../types';

/**
 * 古い端末データでは、計画再生成やタスク削除より前に作られた学習記録が
 * すでに存在しないtaskIdを保持している場合がある。
 *
 * 学習実績そのものとtaskSnapshotBeforeは履歴として残し、現在のtasksへ
 * 解決できない参照だけをnullへ切り離す。正常な状態では元の参照を返す。
 */
export function repairOrphanedSessionTaskReferences(state: AppState): AppState {
  const taskIds = new Set(state.tasks.map((task) => task.id));
  let repaired = false;
  const sessions = state.sessions.map((session) => {
    if (session.taskId === null || session.taskId === undefined || taskIds.has(session.taskId)) return session;
    repaired = true;
    return { ...session, taskId: null };
  });
  return repaired ? { ...state, sessions } : state;
}
