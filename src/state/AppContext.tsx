import { createContext, useCallback, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { AppState } from '../types';
import {
  AppProvider as BaseAppProvider,
  appReducer as baseAppReducer,
  useApp as useBaseApp,
} from './AppContextBase';
import type { Action, AppCommandResult } from './AppContextBase';

export * from './AppContextBase';

type AppContextValue = ReturnType<typeof useBaseApp>;

const GuardedAppContext = createContext<AppContextValue | null>(null);

function protectedDoingTaskMessage(state: AppState, action: Action): string | null {
  const taskId = action.type === 'UPDATE_TASK'
    ? action.task.id
    : action.type === 'POSTPONE_TASK'
      || action.type === 'MOVE_TASK'
      || action.type === 'UNLOCK_TASK'
      || action.type === 'DELETE_TASK'
      ? action.taskId
      : null;
  if (!taskId) return null;
  const current = state.tasks.find((task) => task.id === taskId);
  if (current?.status !== 'doing') return null;

  // タイマー開始時のplanned→doingと、古いdoing状態をplannedへ戻す復旧操作は許可する。
  // doingのまま予定・時間・削除を変更する操作だけを拒否する。
  if (action.type === 'UPDATE_TASK' && action.task.status !== 'doing') return null;
  return '進行中のタスクは変更できません。タイマーを終了してから操作してください';
}

/**
 * Reducerを直接使うテスト・補助処理でも、進行中タスクの予定や削除を変更させない。
 * 実タイマーのない古いdoing状態は、statusをplannedへ戻す同一更新で復旧できる。
 */
export function appReducer(state: AppState, action: Action): AppState {
  if (protectedDoingTaskMessage(state, action)) return state;
  return baseAppReducer(state, action);
}

function GuardedAppBridge({ children }: { children: ReactNode }) {
  const base = useBaseApp();

  const dispatch = useCallback((action: Action) => {
    if (protectedDoingTaskMessage(base.state, action)) return;
    base.dispatch(action);
  }, [base]);

  const execute = useCallback((action: Action): AppCommandResult => {
    const message = protectedDoingTaskMessage(base.state, action);
    if (message) {
      return {
        changed: false,
        scheduleStatus: 'invalidInput',
        message,
        errorCode: 'activeTaskMutation',
      };
    }
    return base.execute(action);
  }, [base]);

  const value = useMemo<AppContextValue>(() => ({ ...base, dispatch, execute }), [base, dispatch, execute]);
  return <GuardedAppContext.Provider value={value}>{children}</GuardedAppContext.Provider>;
}

export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <BaseAppProvider>
      <GuardedAppBridge>{children}</GuardedAppBridge>
    </BaseAppProvider>
  );
}

export function useApp(): AppContextValue {
  const value = useContext(GuardedAppContext);
  if (!value) throw new Error('useApp must be used within AppProvider');
  return value;
}
