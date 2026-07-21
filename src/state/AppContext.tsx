import { createContext, useCallback, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { AppState, StudyTask } from '../types';
import { addDays, today } from '../lib/date';
import {
  AppProvider as BaseAppProvider,
  appReducer as baseAppReducer,
  useApp as useBaseApp,
} from './AppContextBase';
import type { Action, AppCommandResult } from './AppContextBase';

export * from './AppContextBase';

type AppContextValue = ReturnType<typeof useBaseApp>;

const GuardedAppContext = createContext<AppContextValue | null>(null);
const TIMER_STORAGE_KEY = 'studycommander_timer_v1';
const ACTIVE_TASK_MESSAGE = '進行中のタスクは変更できません。タイマーを終了してから操作してください';

function taskIdOf(action: Action): string | null {
  if (action.type === 'UPDATE_TASK') return action.task.id;
  if (action.type === 'POSTPONE_TASK'
    || action.type === 'MOVE_TASK'
    || action.type === 'UNLOCK_TASK'
    || action.type === 'DELETE_TASK') return action.taskId;
  return null;
}

function persistedTimerTaskId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TIMER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { target?: { taskId?: unknown } };
    return typeof parsed.target?.taskId === 'string' ? parsed.target.taskId : null;
  } catch {
    return null;
  }
}

function flexibleManualScheduling(task: StudyTask) {
  if (!task.manualScheduling) return undefined;
  return {
    ...task.manualScheduling,
    placementPolicy: 'flexibleBeforeDeadline' as const,
    fixedDate: undefined,
    fixedStartTime: undefined,
  };
}

function dateLockedManualScheduling(task: StudyTask, date: string) {
  if (!task.manualScheduling) return undefined;
  const canStayFlexible = task.manualScheduling.placementPolicy === 'flexibleBeforeDeadline'
    && !!task.manualScheduling.deadline
    && task.manualScheduling.deadline >= date;
  return canStayFlexible
    ? { ...task.manualScheduling, fixedDate: undefined, fixedStartTime: undefined }
    : {
        ...task.manualScheduling,
        placementPolicy: 'fixedDateFlexibleTime' as const,
        fixedDate: date,
        fixedStartTime: undefined,
      };
}

interface ResolvedAction {
  action?: Action;
  message?: string;
}

/**
 * UI操作ではlocalStorageの実タイマーを照合する。実タイマーが無いdoingは旧保存状態なので、
 * plannedへ戻す同一更新へ変換して操作を成立させる。
 */
function resolveUiAction(state: AppState, action: Action): ResolvedAction {
  const taskId = taskIdOf(action);
  if (!taskId) return { action };
  const current = state.tasks.find((task) => task.id === taskId);
  if (current?.status !== 'doing') return { action };
  if (persistedTimerTaskId() === taskId) return { message: ACTIVE_TASK_MESSAGE };

  const updatedAt = new Date().toISOString();
  if (action.type === 'UPDATE_TASK') {
    return {
      action: {
        ...action,
        task: action.task.status === 'doing' ? { ...action.task, status: 'planned', updatedAt } : action.task,
      },
    };
  }
  if (action.type === 'POSTPONE_TASK') {
    const date = addDays(today(), 1);
    return {
      action: {
        type: 'UPDATE_TASK',
        task: {
          ...current,
          status: 'planned',
          scheduledDate: date,
          scheduledStart: null,
          scheduledEnd: null,
          placementLock: 'date',
          placementStatus: 'unscheduled',
          manualScheduling: dateLockedManualScheduling(current, date),
          manualOrder: undefined,
          updatedAt,
        },
      },
    };
  }
  if (action.type === 'MOVE_TASK') {
    const t = today();
    if (current.dueDate && current.dueDate >= t && action.date > current.dueDate) {
      return { message: '期限を過ぎる日には移動できません' };
    }
    return {
      action: {
        type: 'UPDATE_TASK',
        task: {
          ...current,
          status: 'planned',
          scheduledDate: action.date,
          scheduledStart: null,
          scheduledEnd: null,
          placementLock: 'date',
          placementStatus: 'unscheduled',
          manualScheduling: current.manualScheduling
            ? {
                ...current.manualScheduling,
                placementPolicy: 'fixedDateFlexibleTime',
                fixedDate: action.date,
                fixedStartTime: undefined,
              }
            : undefined,
          manualOrder: undefined,
          updatedAt,
        },
      },
    };
  }
  if (action.type === 'UNLOCK_TASK') {
    return {
      action: {
        type: 'UPDATE_TASK',
        task: {
          ...current,
          status: 'planned',
          placementLock: 'none',
          manualScheduling: flexibleManualScheduling(current),
          generatedBy: current.sourceType === 'manual' ? current.generatedBy : 'auto',
          updatedAt,
        },
      },
    };
  }
  // 実タイマーが無い古いdoingタスクは削除可能。
  return { action };
}

/**
 * Reducerを直接使うテスト・補助処理ではタイマー実体を参照できないため保守的に拒否する。
 * statusをplanned等へ戻す明示的なUPDATE_TASKだけは復旧操作として許可する。
 */
export function appReducer(state: AppState, action: Action): AppState {
  const taskId = taskIdOf(action);
  const current = taskId ? state.tasks.find((task) => task.id === taskId) : undefined;
  if (current?.status === 'doing' && !(action.type === 'UPDATE_TASK' && action.task.status !== 'doing')) return state;
  return baseAppReducer(state, action);
}

function GuardedAppBridge({ children }: { children: ReactNode }) {
  const base = useBaseApp();

  const dispatch = useCallback((action: Action) => {
    const resolved = resolveUiAction(base.state, action);
    if (resolved.action) base.dispatch(resolved.action);
  }, [base]);

  const execute = useCallback((action: Action): AppCommandResult => {
    const resolved = resolveUiAction(base.state, action);
    if (!resolved.action) {
      return {
        changed: false,
        scheduleStatus: 'invalidInput',
        message: resolved.message ?? ACTIVE_TASK_MESSAGE,
        errorCode: 'activeTaskMutation',
      };
    }
    return base.execute(resolved.action);
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
