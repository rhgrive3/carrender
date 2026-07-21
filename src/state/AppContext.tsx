import { createContext, useCallback, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { AppState, StudySession, StudyTask } from '../types';
import { addDays, today } from '../lib/date';
import { emitAppCommandMessage } from '../lib/appCommandEvents';
import { useAuth } from './AuthContext';
import {
  AppProvider as BaseAppProvider,
  appReducer as baseAppReducer,
  useApp as useBaseApp,
} from './AppContextBase';
import type { Action, AppCommandResult, SessionInput } from './AppContextBase';

export * from './AppContextBase';

type AppContextValue = ReturnType<typeof useBaseApp>;

const GuardedAppContext = createContext<AppContextValue | null>(null);
const TIMER_STORAGE_KEY = 'studycommander_timer_v1';
const ACTIVE_TASK_MESSAGE = '進行中のタスクは変更できません。タイマーを終了してから操作してください';
const ACTIVE_RECORD_MESSAGE = '計測中のタスクは、タイマーを終了してから記録してください';

interface ActiveTimerTarget {
  taskId: string | null;
  materialId: string | null;
  sourceId?: string;
  range?: { start: number; end: number };
  type?: StudyTask['type'];
}

function taskIdOf(action: Action): string | null {
  if (action.type === 'UPDATE_TASK') return action.task.id;
  if (action.type === 'POSTPONE_TASK'
    || action.type === 'MOVE_TASK'
    || action.type === 'UNLOCK_TASK'
    || action.type === 'DELETE_TASK') return action.taskId;
  return null;
}

function persistedTimerTarget(owner: string | null): ActiveTimerTarget | null {
  if (typeof localStorage === 'undefined' || !owner) return null;
  try {
    const raw = localStorage.getItem(TIMER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { owner?: unknown; target?: Partial<ActiveTimerTarget> };
    if (parsed.owner !== owner || !parsed.target) return null;
    const taskId = parsed.target.taskId;
    const materialId = parsed.target.materialId;
    if (taskId !== null && typeof taskId !== 'string') return null;
    if (materialId !== null && typeof materialId !== 'string') return null;
    return {
      taskId: taskId ?? null,
      materialId: materialId ?? null,
      ...(typeof parsed.target.sourceId === 'string' ? { sourceId: parsed.target.sourceId } : {}),
      ...(parsed.target.range
        && Number.isFinite(parsed.target.range.start)
        && Number.isFinite(parsed.target.range.end)
        ? { range: { start: parsed.target.range.start, end: parsed.target.range.end } }
        : {}),
      ...(parsed.target.type ? { type: parsed.target.type } : {}),
    };
  } catch {
    return null;
  }
}

function rangeOfTask(task: StudyTask): { start: number; end: number } | undefined {
  return task.materialRange
    ?? (Number.isFinite(task.rangeStart) && Number.isFinite(task.rangeEnd)
      ? { start: task.rangeStart!, end: task.rangeEnd! }
      : undefined);
}

function locatorMatchesTarget(
  target: ActiveTimerTarget,
  locator: SessionInput['taskLocator'] | undefined,
  materialId: string | null,
): boolean {
  if (!target.sourceId || !locator?.sourceId || target.sourceId !== locator.sourceId || target.materialId !== materialId) return false;
  if (target.type && locator.type && target.type !== locator.type) return false;
  if (!target.range || !locator.range) return !target.range && !locator.range;
  return target.range.start === locator.range.start && target.range.end === locator.range.end;
}

function targetMatchesTask(target: ActiveTimerTarget, task: StudyTask): boolean {
  if (target.taskId && target.taskId === task.id) return true;
  if (!target.sourceId || target.sourceId !== task.sourceId || target.materialId !== task.materialId) return false;
  if (target.type && target.type !== task.type) return false;
  const range = rangeOfTask(task);
  if (!target.range || !range) return !target.range && !range;
  return target.range.start === range.start && target.range.end === range.end;
}

function targetMatchesSessionInput(target: ActiveTimerTarget, input: SessionInput): boolean {
  return Boolean(
    (target.taskId && input.taskId === target.taskId)
    || locatorMatchesTarget(target, input.taskLocator, input.materialId),
  );
}

function targetMatchesSession(target: ActiveTimerTarget, session: StudySession): boolean {
  if (target.taskId && session.taskId === target.taskId) return true;
  if (session.taskSnapshotBefore && targetMatchesTask(target, session.taskSnapshotBefore)) return true;
  return false;
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

function mutatesActiveTimerRecord(state: AppState, action: Action, target: ActiveTimerTarget | null): boolean {
  if (!target) return false;
  if (action.type === 'RECORD_SESSION') {
    return action.input.source !== 'timer' && targetMatchesSessionInput(target, action.input);
  }
  if (action.type === 'UPDATE_SESSION') {
    const previous = state.sessions.find((session) => session.id === action.sessionId);
    return Boolean(previous && targetMatchesSession(target, previous)) || targetMatchesSessionInput(target, action.input);
  }
  if (action.type === 'DELETE_SESSION') {
    const previous = state.sessions.find((session) => session.id === action.sessionId);
    return Boolean(previous && targetMatchesSession(target, previous));
  }
  return false;
}

/**
 * UI操作では、現在の所有者に属するlocalStorage上の実タイマーを照合する。
 * 実タイマーが無いdoingは旧保存状態なので、plannedへ戻す同一更新へ変換して操作を成立させる。
 */
function resolveUiAction(state: AppState, action: Action, owner: string | null): ResolvedAction {
  const activeTimerTarget = persistedTimerTarget(owner);
  if (mutatesActiveTimerRecord(state, action, activeTimerTarget)) return { message: ACTIVE_RECORD_MESSAGE };

  const taskId = taskIdOf(action);
  if (!taskId) return { action };
  const current = state.tasks.find((task) => task.id === taskId);
  if (!current) return { action };
  if (activeTimerTarget && targetMatchesTask(activeTimerTarget, current)) return { message: ACTIVE_TASK_MESSAGE };
  if (current.status !== 'doing') return { action };

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

function rejectedCommandResult(message: string): AppCommandResult {
  let messageRead = false;
  const result = {
    changed: false,
    scheduleStatus: 'invalidInput' as const,
    errorCode: 'activeTaskMutation',
  } as AppCommandResult;
  Object.defineProperty(result, 'message', {
    enumerable: true,
    get() {
      messageRead = true;
      return message;
    },
  });
  queueMicrotask(() => {
    // 呼び出し側がresult.messageを読んだ場合は、そちらのトースト表示に任せる。
    // 戻り値を無視する導線だけ、中央から明示的な通知を補う。
    if (!messageRead) emitAppCommandMessage(message, 'warning');
  });
  return result;
}

function GuardedAppBridge({ children }: { children: ReactNode }) {
  const base = useBaseApp();
  const { user } = useAuth();
  const owner = user?.username ?? null;

  const dispatch = useCallback((action: Action) => {
    const resolved = resolveUiAction(base.state, action, owner);
    if (resolved.action) {
      base.dispatch(resolved.action);
      return;
    }
    if (resolved.message) emitAppCommandMessage(resolved.message, 'warning');
  }, [base, owner]);

  const execute = useCallback((action: Action): AppCommandResult => {
    const resolved = resolveUiAction(base.state, action, owner);
    if (!resolved.action) return rejectedCommandResult(resolved.message ?? ACTIVE_TASK_MESSAGE);
    return base.execute(resolved.action);
  }, [base, owner]);

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
