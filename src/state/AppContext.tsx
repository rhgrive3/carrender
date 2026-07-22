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
import type { Action, AppCommandResult, SessionInput } from './AppContextBase';

export * from './AppContextBase';

type AppContextValue = ReturnType<typeof useBaseApp>;

const GuardedAppContext = createContext<AppContextValue | null>(null);
const TIMER_STORAGE_KEY = 'studycommander_timer_v1';
const ACTIVE_TASK_MESSAGE = '進行中のタスクは変更できません。タイマーを終了してから操作してください';
const ACTIVE_RECORD_MESSAGE = '計測中のタスクは、タイマーを終了してから記録してください';

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
    const date = addDays(options.todayDate ?? today(), 1);
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
    const currentDate = options.todayDate ?? today();
    if (current.dueDate && current.dueDate >= currentDate && action.date > current.dueDate) {
      return { status: 'rejected', message: '期限を過ぎる日には移動できません', errorCode: 'pastDueDate' };
    }
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
    return { status: 'noChange', message: ACTIVE_TASK_MESSAGE };
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

function rejectedCommandResult(message: string, errorCode = 'invalidInput'): AppCommandResult {
  let messageRead = false;
  const result = {
    changed: false,
    scheduleStatus: 'invalidInput' as const,
    errorCode,
  } as AppCommandResult;
  Object.defineProperty(result, 'message', {
    enumerable: true,
    get() {
      messageRead = true;
      return message;
    },
  });
  queueMicrotask(() => {
    if (!messageRead) emitAppCommandMessage(message, 'warning');
  });
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
      if (resolved.message) emitAppCommandMessage(resolved.message, 'warning');
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

  const execute = useCallback((action: Action): AppCommandResult => {
    const resolved = resolveAppAction(base.state, action, {
      activeTimerTarget: persistedTimerTarget(owner),
    });
    if (resolved.status !== 'ready') {
      return rejectedCommandResult(
        resolved.message ?? '入力内容を確認してください',
        resolved.status === 'rejected' ? resolved.errorCode : 'noChange',
      );
    }
    if (resolved.action.type === 'ADD_MATERIAL' || resolved.action.type === 'UPDATE_MATERIAL') {
      const validation = materialValidationError(resolved.action.material);
      if (validation) return rejectedCommandResult(validation);
    }
    if (requiresDeterministicReplacement(base.state, resolved.action)) {
      const next = deterministicReducer(base.state, resolved.action);
      if (next === base.state) return rejectedCommandResult('入力内容を確認してください');
      return base.execute({ type: 'REPLACE_STATE', state: next });
    }
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
