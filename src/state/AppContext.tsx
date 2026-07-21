import { createContext, useCallback, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { AppState, Material, StudySession, StudyTask } from '../types';
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
  return { action };
}

function materialValidationError(material: Material): string | undefined {
  if (!Number.isFinite(material.totalAmount) || material.totalAmount <= 0) return '教材の総量は1以上にしてください';
  if (!Number.isFinite(material.doneAmount) || material.doneAmount < 0 || material.doneAmount > material.totalAmount) return '終わった量は0以上、総量以下にしてください';
  if (material.preferredCadence?.type === 'timesPerWeek'
    && (!Number.isInteger(material.preferredCadence.count) || material.preferredCadence.count < 1 || material.preferredCadence.count > 7)) {
    return '週あたり回数は1〜7回にしてください';
  }
  if (material.maximumChunkUnits !== undefined && material.maximumChunkUnits < Math.max(1, material.minimumChunkUnits ?? 1)) {
    return '最大チャンクは最小チャンク以上にしてください';
  }
  if (material.reviewIntervals.some((value) => !Number.isInteger(value) || value <= 0)) return '復習間隔は正の整数で入力してください';
  return undefined;
}

function hasSameEstimateObservation(previous: StudySession, input: SessionInput): boolean {
  return previous.materialId === input.materialId
    && previous.minutes === input.minutes
    && previous.amountDone === input.amountDone
    && !previous.excludedFromEstimate
    && !previous.pausedMinutes;
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

function deterministicReducer(state: AppState, action: Action): AppState {
  if (action.type === 'ADD_MATERIAL' || action.type === 'UPDATE_MATERIAL') {
    if (materialValidationError(action.material)) return state;
  }
  if (action.type === 'UPDATE_MATERIAL' && action.material.completedRanges) {
    // Base reducer historically re-derived ranges from the old material and could
    // replace clipped completed ranges with unrelated early units. Seed the reducer
    // with the exact range decision confirmed by the form so planning uses it too.
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
    const next = baseAppReducer(state, action);
    return previous && hasSameEstimateObservation(previous, action.input)
      ? preserveMaterialEstimates(state, next)
      : next;
  }
  return baseAppReducer(state, action);
}

/** Reducerを直接使うテスト・補助処理でもUIと同じ整合性境界を適用する。 */
export function appReducer(state: AppState, action: Action): AppState {
  const taskId = taskIdOf(action);
  const current = taskId ? state.tasks.find((task) => task.id === taskId) : undefined;
  if (current?.status === 'doing' && !(action.type === 'UPDATE_TASK' && action.task.status !== 'doing')) return state;
  return deterministicReducer(state, action);
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
  const previous = state.sessions.find((session) => session.id === action.sessionId);
  return Boolean(previous && hasSameEstimateObservation(previous, action.input));
}

function GuardedAppBridge({ children }: { children: ReactNode }) {
  const base = useBaseApp();
  const { user } = useAuth();
  const owner = user?.username ?? null;

  const dispatch = useCallback((action: Action) => {
    const resolved = resolveUiAction(base.state, action, owner);
    if (!resolved.action) {
      if (resolved.message) emitAppCommandMessage(resolved.message, 'warning');
      return;
    }
    if ((resolved.action.type === 'ADD_MATERIAL' || resolved.action.type === 'UPDATE_MATERIAL')) {
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
    const resolved = resolveUiAction(base.state, action, owner);
    if (!resolved.action) return rejectedCommandResult(resolved.message ?? ACTIVE_TASK_MESSAGE, 'activeTaskMutation');
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
