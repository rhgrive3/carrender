import { createContext, useCallback, useContext, useLayoutEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { AppState, Material, StudySession, StudyTask } from '../types';
import { addDays, today } from '../lib/date';
import { emitAppCommandMessage } from '../lib/appCommandEvents';
import { clearAppStateSnapshot, publishAppStateSnapshot } from '../lib/appStateSnapshot';
import { validateMaterialIntegrity } from '../lib/materialIntegrity';
import {
  parsePersistedTimerTarget,
  timerTargetMatchesSession,
  timerTargetMatchesSessionInput,
  timerTargetMatchesTask,
  type TimerTargetLocator,
} from '../lib/timerTargetIdentity';
import { useAuth } from './AuthContext';
import {
  AppProvider as BaseAppProvider,
  appReducer as baseAppReducer,
  useApp as useBaseApp,
} from './AppContextBase';
import type {
  Action,
  AppCommandResult as BaseAppCommandResult,
  SessionInput,
} from './AppContextBase';
import type { SessionMutationAction } from '../lib/sessionMutation';

export * from './AppContextBase';

export interface AppCommandExecutionOptions {
  /** 呼出側が独自表示する場合だけ共通Toastを抑止する。 */
  suppressNotification?: boolean;
}

export type AppCommandResult =
  | (BaseAppCommandResult & { status: 'success'; changed: true })
  | (BaseAppCommandResult & {
      status: 'rejected';
      changed: false;
      message: string;
      errorCode: string;
    })
  | (BaseAppCommandResult & {
      status: 'noChange';
      changed: false;
    });

type AppContextValue = Omit<ReturnType<typeof useBaseApp>, 'execute' | 'executeSession'> & {
  execute: (action: Action, options?: AppCommandExecutionOptions) => AppCommandResult;
  executeSession: (action: SessionMutationAction, options?: AppCommandExecutionOptions) => AppCommandResult;
};

const GuardedAppContext = createContext<AppContextValue | null>(null);
const TIMER_STORAGE_KEY = 'studycommander_timer_v1';
const ACTIVE_TASK_MESSAGE = '進行中のタスクは変更できません。タイマーを終了してから操作してください';
const ACTIVE_RECORD_MESSAGE = '計測中のタスクは、タイマーを終了してから記録してください';
const PAST_DUE_DATE_MESSAGE = '期限を過ぎる日には移動できません';

function taskIdOf(action: Action): string | null {
  if (action.type === 'UPDATE_TASK') return action.task.id;
  if (action.type === 'POSTPONE_TASK'
    || action.type === 'MOVE_TASK'
    || action.type === 'UNLOCK_TASK'
    || action.type === 'DELETE_TASK') return action.taskId;
  return null;
}

function persistedTimerTarget(owner: string | null): TimerTargetLocator | null {
  if (typeof localStorage === 'undefined' || !owner) return null;
  try {
    const raw = localStorage.getItem(TIMER_STORAGE_KEY);
    return raw ? parsePersistedTimerTarget(JSON.parse(raw), owner) : null;
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

function movesBeyondActiveDueDate(task: StudyTask, date: string, currentDate: string): boolean {
  return Boolean(task.dueDate && task.dueDate >= currentDate && date > task.dueDate);
}

export type AppActionResolution =
  | { status: 'ready'; action: Action }
  | { status: 'rejected'; message: string; errorCode: string }
  | { status: 'noChange'; message?: string };

export interface ResolveAppActionOptions {
  activeTimerTarget?: TimerTargetLocator | null;
  nowIso?: string;
  todayDate?: string;
}

function mutatesActiveTimerRecord(state: AppState, action: Action, target: TimerTargetLocator | null): boolean {
  if (!target) return false;
  if (action.type === 'RECORD_SESSION') {
    return action.input.source !== 'timer' && timerTargetMatchesSessionInput(target, action.input);
  }
  if (action.type === 'UPDATE_SESSION') {
    const previous = state.sessions.find((session) => session.id === action.sessionId);
    return Boolean(previous && timerTargetMatchesSession(target, previous))
      || timerTargetMatchesSessionInput(target, action.input);
  }
  if (action.type === 'DELETE_SESSION') {
    const previous = state.sessions.find((session) => session.id === action.sessionId);
    return Boolean(previous && timerTargetMatchesSession(target, previous));
  }
  return false;
}

export function resolveAppAction(
  state: AppState,
  action: Action,
  options: ResolveAppActionOptions = {},
): AppActionResolution {
  const activeTimerTarget = options.activeTimerTarget ?? null;
  if (mutatesActiveTimerRecord(state, action, activeTimerTarget)) {
    return { status: 'rejected', message: ACTIVE_RECORD_MESSAGE, errorCode: 'activeRecordMutation' };
  }

  const taskId = taskIdOf(action);
  if (!taskId) return { status: 'ready', action };
  const current = state.tasks.find((task) => task.id === taskId);
  if (!current) return { status: 'ready', action };
  if (activeTimerTarget && timerTargetMatchesTask(activeTimerTarget, current)) {
    return { status: 'rejected', message: ACTIVE_TASK_MESSAGE, errorCode: 'activeTaskMutation' };
  }

  const currentDate = options.todayDate ?? today();
  const postponeDate = action.type === 'POSTPONE_TASK' ? addDays(currentDate, 1) : undefined;
  if (postponeDate && movesBeyondActiveDueDate(current, postponeDate, currentDate)) {
    return { status: 'rejected', message: PAST_DUE_DATE_MESSAGE, errorCode: 'pastDueDate' };
  }
  if (action.type === 'MOVE_TASK' && movesBeyondActiveDueDate(current, action.date, currentDate)) {
    return { status: 'rejected', message: PAST_DUE_DATE_MESSAGE, errorCode: 'pastDueDate' };
  }
  if (current.status !== 'doing') return { status: 'ready', action };

  const updatedAt = options.nowIso ?? new Date().toISOString();
  if (action.type === 'UPDATE_TASK') {
    return {
      status: 'ready',
      action: {
        ...action,
        task: action.task.status === 'doing' ? { ...action.task, status: 'planned', updatedAt } : action.task,
      },
    };
  }
  if (action.type === 'POSTPONE_TASK') {
    const date = postponeDate ?? addDays(currentDate, 1);
    return {
      status: 'ready',
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
    return {
      status: 'ready',
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
      status: 'ready',
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
  if (action.type === 'DELETE_TASK') {
    return { status: 'rejected', message: ACTIVE_TASK_MESSAGE, errorCode: 'activeTaskMutation' };
  }
  return { status: 'ready', action };
}

function materialValidationError(material: Material): string | undefined {
  return validateMaterialIntegrity(material)[0]?.reason;
}

function hasSameEstimateObservation(previous: StudySession, input: SessionInput): boolean {
  return previous.materialId === input.materialId
    && previous.minutes === input.minutes
    && previous.amountDone === input.amountDone;
}

function preserveMaterialEstimates(previous: AppState, next: AppState): AppState {
  const estimates = new Map(previous.materials.map((material) => [material.id, {
    minutesPerUnit: material.minutesPerUnit,
    estimatedMinutesPerUnit: material.estimatedMinutesPerUnit,
  }]));
  return {
    ...next,
    materials: next.materials.map((material) => {
      const before = estimates.get(material.id);
      return before ? { ...material, ...before } : material;
    }),
  };
}

function preserveSessionEstimateMetadata(previous: StudySession, next: AppState): AppState {
  return {
    ...next,
    sessions: next.sessions.map((session) => session.id === previous.id
      ? {
          ...session,
          ...(previous.pausedMinutes !== undefined ? { pausedMinutes: previous.pausedMinutes } : {}),
          ...(previous.excludedFromEstimate !== undefined ? { excludedFromEstimate: previous.excludedFromEstimate } : {}),
        }
      : session),
  };
}

function deterministicReducer(state: AppState, action: Action): AppState {
  if (action.type === 'ADD_MATERIAL' || action.type === 'UPDATE_MATERIAL') {
    if (materialValidationError(action.material)) return state;
  }
  if (action.type === 'UPDATE_MATERIAL' && action.material.completedRanges) {
    const prepared: AppState = {
      ...state,
      materials: state.materials.map((material) => material.id === action.material.id
        ? { ...material, completedRanges: action.material.completedRanges, doneAmount: action.material.doneAmount }
        : material),
    };
    return baseAppReducer(prepared, action);
  }
  if (action.type === 'UPDATE_SESSION') {
    const previous = state.sessions.find((session) => session.id === action.sessionId);
    const reduced = baseAppReducer(state, action);
    if (!previous) return reduced;
    const next = preserveSessionEstimateMetadata(previous, reduced);
    return hasSameEstimateObservation(previous, action.input)
      ? preserveMaterialEstimates(state, next)
      : next;
  }
  return baseAppReducer(state, action);
}

export function appReducer(state: AppState, action: Action): AppState {
  const resolved = resolveAppAction(state, action);
  if (resolved.status !== 'ready') return state;
  return deterministicReducer(state, resolved.action);
}

export function createRejectedAppCommandResult(
  message: string,
  errorCode = 'invalidInput',
): AppCommandResult {
  return {
    status: 'rejected',
    changed: false,
    scheduleStatus: 'invalidInput',
    message,
    errorCode,
  };
}

export function createNoChangeAppCommandResult(
  message?: string,
  errorCode = 'noChange',
): AppCommandResult {
  return {
    status: 'noChange',
    changed: false,
    ...(message ? { message } : {}),
    errorCode,
  };
}

function normalizeBaseCommandResult(result: BaseAppCommandResult): AppCommandResult {
  if (result.changed) return { ...result, status: 'success', changed: true };
  if (result.scheduleStatus === 'invalidInput' || (result.errorCode && result.errorCode !== 'noChange')) {
    return createRejectedAppCommandResult(
      result.message ?? '入力内容を確認してください',
      result.errorCode ?? 'invalidInput',
    );
  }
  return createNoChangeAppCommandResult(result.message, result.errorCode ?? 'noChange');
}

export function notifyAppCommandResult(
  result: AppCommandResult,
  options: AppCommandExecutionOptions = {},
): AppCommandResult {
  if (result.status === 'rejected' && !options.suppressNotification) {
    emitAppCommandMessage(result.message, 'warning');
  }
  return result;
}

function requiresDeterministicReplacement(state: AppState, action: Action): boolean {
  if (action.type === 'UPDATE_MATERIAL' && Boolean(action.material.completedRanges)) return true;
  if (action.type !== 'UPDATE_SESSION') return false;
  return state.sessions.some((session) => session.id === action.sessionId);
}

function GuardedAppBridge({ children }: { children: ReactNode }) {
  const base = useBaseApp();
  const { user } = useAuth();
  const owner = user?.username ?? null;

  useLayoutEffect(() => {
    publishAppStateSnapshot(owner, base.state);
  }, [base.state, owner]);

  useLayoutEffect(() => () => {
    clearAppStateSnapshot(owner);
  }, [owner]);

  const dispatch = useCallback((action: Action) => {
    const resolved = resolveAppAction(base.state, action, {
      activeTimerTarget: persistedTimerTarget(owner),
    });
    if (resolved.status !== 'ready') {
      if (resolved.status === 'rejected') emitAppCommandMessage(resolved.message, 'warning');
      return;
    }
    if (resolved.action.type === 'ADD_MATERIAL' || resolved.action.type === 'UPDATE_MATERIAL') {
      const validation = materialValidationError(resolved.action.material);
      if (validation) {
        emitAppCommandMessage(validation, 'warning');
        return;
      }
    }
    if (requiresDeterministicReplacement(base.state, resolved.action)) {
      base.dispatch({ type: 'REPLACE_STATE', state: deterministicReducer(base.state, resolved.action) });
      return;
    }
    base.dispatch(resolved.action);
  }, [base, owner]);

  const execute = useCallback((
    action: Action,
    options: AppCommandExecutionOptions = {},
  ): AppCommandResult => {
    const finish = (result: AppCommandResult) => notifyAppCommandResult(result, options);
    const resolved = resolveAppAction(base.state, action, {
      activeTimerTarget: persistedTimerTarget(owner),
    });
    if (resolved.status === 'rejected') {
      return finish(createRejectedAppCommandResult(resolved.message, resolved.errorCode));
    }
    if (resolved.status === 'noChange') {
      return createNoChangeAppCommandResult(resolved.message);
    }
    if (resolved.action.type === 'ADD_MATERIAL' || resolved.action.type === 'UPDATE_MATERIAL') {
      const validation = materialValidationError(resolved.action.material);
      if (validation) return finish(createRejectedAppCommandResult(validation));
    }
    if (requiresDeterministicReplacement(base.state, resolved.action)) {
      const next = deterministicReducer(base.state, resolved.action);
      if (next === base.state) return createNoChangeAppCommandResult();
      return finish(normalizeBaseCommandResult(base.execute({ type: 'REPLACE_STATE', state: next })));
    }
    return finish(normalizeBaseCommandResult(base.execute(resolved.action)));
  }, [base, owner]);

  const executeSession = useCallback((
    action: SessionMutationAction,
    options: AppCommandExecutionOptions = {},
  ): AppCommandResult => {
    const finish = (result: AppCommandResult) => notifyAppCommandResult(result, options);
    const resolved = resolveAppAction(base.state, action, {
      activeTimerTarget: persistedTimerTarget(owner),
    });
    if (resolved.status === 'rejected') {
      return finish(createRejectedAppCommandResult(resolved.message, resolved.errorCode));
    }
    if (resolved.status === 'noChange') return createNoChangeAppCommandResult(resolved.message);
    if (resolved.action.type !== 'RECORD_SESSION'
      && resolved.action.type !== 'UPDATE_SESSION'
      && resolved.action.type !== 'DELETE_SESSION') {
      return finish(createRejectedAppCommandResult('記録操作を確認できません', 'invalidSessionAction'));
    }
    return finish(normalizeBaseCommandResult(base.executeSession(resolved.action)));
  }, [base, owner]);

  const value = useMemo<AppContextValue>(() => ({ ...base, dispatch, execute, executeSession }), [base, dispatch, execute, executeSession]);
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
