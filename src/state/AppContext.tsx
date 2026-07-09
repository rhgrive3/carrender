import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  AppState,
  AppSettings,
  AvailabilitySlot,
  DayPlanOverride,
  FixedEvent,
  ISODate,
  Material,
  StudySession,
  StudyTask,
  Subject,
  UserGoal,
} from '../types';
import { loadState, saveState, saveStateNow, clearState, getStateOwner, setStateOwner, normalizeState, STATE_VERSION } from '../lib/storage';
import { freeSlotsOn, generatePlan, subtractBusySlots, taskBusySlots } from '../lib/scheduler';
import { generateReviewTasks } from '../lib/review';
import { addDays, genId, hmToMinutes, minutesToHM, today } from '../lib/date';
import { buildDemoState } from '../data/demo';
import { defaultSettings, defaultAvailability } from '../data/defaults';
import { useAuth } from './AuthContext';
import { apiGetData, apiPutData } from '../lib/api';
import type { ApiError } from '../lib/api';

// ============================================================
// アクション定義
// ============================================================

export interface SessionInput {
  taskId: string | null;
  subjectId: string;
  materialId: string | null;
  minutes: number;
  amountDone: number;
  focus: 1 | 2 | 3 | 4 | 5 | null;
  memo: string;
  source: 'timer' | 'manual';
  rangeLabel: string;
  completedTask: boolean; // タスクを完了扱いにするか
}

export interface OnboardingInput {
  goalName: string;
  examDate: ISODate;
  subjects: { name: string; color: string; importance: 1 | 2 | 3 | 4 | 5; weakness: 1 | 2 | 3 | 4 | 5 }[];
  weekdayMinutes: number;
  weekendMinutes: number;
  materials: {
    subjectIndex: number;
    name: string;
    unit: Material['unit'];
    totalAmount: number;
    targetDate: ISODate;
    minutesPerUnit: number;
  }[];
}

export type Action =
  | { type: 'LOAD_DEMO' }
  | { type: 'RESET_ALL' }
  | { type: 'IMPORT_STATE'; state: AppState }
  | { type: 'COMPLETE_ONBOARDING'; input: OnboardingInput }
  | { type: 'ADD_MATERIAL'; material: Material }
  | { type: 'UPDATE_MATERIAL'; material: Material }
  | { type: 'DELETE_MATERIAL'; materialId: string }
  | { type: 'ADD_SUBJECT'; subject: Subject }
  | { type: 'UPDATE_SUBJECT'; subject: Subject }
  | { type: 'ADD_MANUAL_TASK'; task: StudyTask }
  | { type: 'UPDATE_TASK'; task: StudyTask }
  | { type: 'DELETE_TASK'; taskId: string }
  | { type: 'REORDER_TASK'; taskId: string; direction: 'up' | 'down' }
  | { type: 'RECORD_SESSION'; input: SessionInput }
  | { type: 'POSTPONE_TASK'; taskId: string }
  | { type: 'MOVE_TASK'; taskId: string; date: ISODate }
  | { type: 'RESCHEDULE'; reason: string }
  | { type: 'RESCHEDULE_FROM'; fromDate: ISODate; reason: string }
  | { type: 'TODAY_IMPOSSIBLE' }
  | { type: 'UPDATE_GOAL'; goal: UserGoal }
  | { type: 'UPDATE_AVAILABILITY'; availability: AvailabilitySlot[] }
  | { type: 'UPDATE_DAY_PLAN'; dayPlan: DayPlanOverride }
  | { type: 'UPDATE_FIXED_EVENTS'; fixedEvents: FixedEvent[] }
  | { type: 'UPDATE_SETTINGS'; settings: AppSettings }
  | { type: 'DISMISS_RESCHEDULE_BANNER' };

// ============================================================
// Reducer
// ============================================================

export function appReducer(state: AppState, action: Action): AppState {
  const t = today();
  switch (action.type) {
    case 'LOAD_DEMO':
      return buildDemoState();

    case 'RESET_ALL':
      return emptyState();

    case 'IMPORT_STATE':
      return { ...action.state };

    case 'COMPLETE_ONBOARDING': {
      const inp = action.input;
      const subjects: Subject[] = inp.subjects.map((s) => ({
        id: genId('subj'),
        name: s.name,
        color: s.color,
        importance: s.importance,
        weakness: s.weakness,
      }));
      const materials: Material[] = inp.materials.map((m) => ({
        id: genId('mat'),
        subjectId: subjects[m.subjectIndex]?.id ?? subjects[0].id,
        name: m.name,
        unit: m.unit,
        totalAmount: m.totalAmount,
        doneAmount: 0,
        startDate: t,
        targetDate: m.targetDate,
        priority: 3,
        difficulty: 3,
        minutesPerUnit: m.minutesPerUnit,
        dailyTarget: null,
        weeklyTarget: null,
        deadlinePolicy: 'normal',
        examRelevance: 3,
        reviewEnabled: false,
        reviewIntervals: defaultSettings().reviewRule.intervals,
        paused: false,
        round: 1,
        archived: false,
        createdAt: new Date().toISOString(),
      }));
      const defaultSlots = defaultAvailability();
      const availability: AvailabilitySlot[] = ([0, 1, 2, 3, 4, 5, 6] as const).map((wd) => {
        const minutes = wd === 0 || wd === 6 ? inp.weekendMinutes : inp.weekdayMinutes;
        const fallback = defaultSlots.find((slot) => slot.weekday === wd)!;
        const start = wd === 0 || wd === 6 ? '09:00' : '18:00';
        const startMin = hmToMinutes(start);
        return { ...fallback, minutes, windows: minutes > 0 ? [{ start, end: minutesToHM(startMin + minutes) }] : [] };
      });
      const base: AppState = {
        ...emptyState(),
        onboarded: true,
        isDemo: false,
        goal: { id: genId('goal'), name: inp.goalName, examDate: inp.examDate, createdAt: new Date().toISOString() },
        subjects,
        materials,
        availability,
      };
      const { state: planned } = generatePlan(base, t, '初期計画の作成');
      // 初回は「再設計しました」バナーを出さない
      return { ...planned, lastReschedule: null };
    }

    case 'ADD_MATERIAL': {
      const next = { ...state, materials: [...state.materials, action.material] };
      return generatePlan(next, t, `教材「${action.material.name}」の追加`).state;
    }

    case 'UPDATE_MATERIAL': {
      const next = {
        ...state,
        materials: state.materials.map((m) => (m.id === action.material.id ? action.material : m)),
      };
      return generatePlan(next, t, `教材「${action.material.name}」の変更`).state;
    }

    case 'DELETE_MATERIAL': {
      const name = state.materials.find((m) => m.id === action.materialId)?.name ?? '';
      const next = {
        ...state,
        materials: state.materials.filter((m) => m.id !== action.materialId),
        tasks: state.tasks.filter((tk) => tk.materialId !== action.materialId || tk.status === 'done'),
      };
      return generatePlan(next, t, `教材「${name}」の削除`).state;
    }

    case 'ADD_SUBJECT':
      return { ...state, subjects: [...state.subjects, action.subject] };

    case 'UPDATE_SUBJECT': {
      const next = {
        ...state,
        subjects: state.subjects.map((s) => (s.id === action.subject.id ? action.subject : s)),
      };
      return generatePlan(next, t, `科目「${action.subject.name}」設定の変更`).state;
    }

    case 'ADD_MANUAL_TASK':
      return { ...state, tasks: [...state.tasks, action.task] };

    case 'UPDATE_TASK':
      return {
        ...state,
        tasks: state.tasks.map((x) => (x.id === action.task.id ? action.task : x)),
      };

    case 'DELETE_TASK': {
      return { ...state, tasks: state.tasks.filter((x) => x.id !== action.taskId) };
    }

    case 'REORDER_TASK': {
      const task = state.tasks.find((x) => x.id === action.taskId);
      if (!task) return state;
      const list = state.tasks
        .filter((x) => x.scheduledDate === task.scheduledDate && x.status !== 'skipped' && x.status !== 'done')
        .sort((a, b) => (a.scheduledStart ?? '99:99').localeCompare(b.scheduledStart ?? '99:99') || b.priority - a.priority);
      const index = list.findIndex((x) => x.id === action.taskId);
      const target = action.direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= list.length) return state;
      const reordered = [...list];
      const [picked] = reordered.splice(index, 1);
      reordered.splice(target, 0, picked);
      // 固定予定と完了/実行中タスクの時間帯を避けた空き枠に、新しい順序で詰め直す
      const occupied = taskBusySlots(
        state.tasks.filter(
          (x) => x.scheduledDate === task.scheduledDate && (x.status === 'done' || x.status === 'doing'),
        ),
      );
      const slots = subtractBusySlots(freeSlotsOn(state, task.scheduledDate), occupied);
      let cursor = Math.min(...reordered.map((x) => (x.scheduledStart ? hmToMinutes(x.scheduledStart) : Number.POSITIVE_INFINITY)));
      if (!Number.isFinite(cursor)) cursor = slots[0]?.start ?? 18 * 60;
      let slotIdx = 0;
      const times = new Map<string, { start: string; end: string }>();
      for (const item of reordered) {
        const need = item.estimatedMinutes;
        let placed: { start: number; end: number } | null = null;
        while (slotIdx < slots.length) {
          const slot = slots[slotIdx];
          const start = Math.max(cursor, slot.start);
          if (slot.end - start >= need) {
            placed = { start, end: start + need };
            break;
          }
          slotIdx += 1;
          if (slotIdx < slots.length) cursor = Math.max(cursor, slots[slotIdx].start);
        }
        // 空き枠が尽きたら末尾に連結(従来挙動のフォールバック)
        if (!placed) placed = { start: cursor, end: cursor + need };
        times.set(item.id, { start: minutesToHM(placed.start), end: minutesToHM(placed.end) });
        cursor = placed.end + 5;
      }
      return {
        ...state,
        tasks: state.tasks.map((x) => {
          const time = times.get(x.id);
          return time ? { ...x, scheduledStart: time.start, scheduledEnd: time.end, generatedBy: 'manual' as const } : x;
        }),
      };
    }

    case 'RECORD_SESSION': {
      const inp = action.input;
      const session: StudySession = {
        id: genId('sess'),
        taskId: inp.taskId,
        subjectId: inp.subjectId,
        materialId: inp.materialId,
        date: t,
        startedAt: new Date().toISOString(),
        minutes: inp.minutes,
        amountDone: inp.amountDone,
        rangeLabel: inp.rangeLabel,
        focus: inp.focus,
        memo: inp.memo,
        source: inp.source,
      };

      // 教材進捗を更新
      let materials = state.materials;
      if (inp.materialId && inp.amountDone > 0) {
        materials = state.materials.map((m) =>
          m.id === inp.materialId
            ? { ...m, doneAmount: Math.min(m.totalAmount, m.doneAmount + inp.amountDone) }
            : m,
        );
      }

      // タスク完了処理 + 復習タスク生成
      let tasks = state.tasks;
      let newReviews: StudyTask[] = [];
      const task = inp.taskId ? state.tasks.find((x) => x.id === inp.taskId) : undefined;
      if (task && inp.completedTask && task.status !== 'done') {
        tasks = tasks.map((x) =>
          x.id === task.id ? { ...x, status: 'done' as const, completedAt: new Date().toISOString() } : x,
        );
        newReviews = generateReviewTasks({ ...state, materials }, task, t);
      }

      const next: AppState = {
        ...state,
        materials,
        tasks: [...tasks, ...newReviews],
        sessions: [...state.sessions, session],
      };

      // 実績とのズレを翌日以降に反映(今日の残りタスクは維持)
      const replanned = generatePlan(next, addDays(t, 1), '学習実績の反映');
      // 当日中の再スケジュールバナーは騒がしいので、復習が生まれた時のみ結果を残す
      return newReviews.length > 0 || (task && !inp.completedTask)
        ? replanned.state
        : { ...replanned.state, lastReschedule: null };
    }

    case 'POSTPONE_TASK': {
      const task = state.tasks.find((x) => x.id === action.taskId);
      if (!task || task.status === 'done') return state;
      const next = {
        ...state,
        tasks: state.tasks.map((x) =>
          x.id === action.taskId ? { ...x, status: 'postponed' as const, scheduledDate: addDays(t, 1) } : x,
        ),
      };
      return generatePlan(next, addDays(t, 1), `「${task.title}」の延期`).state;
    }

    case 'MOVE_TASK': {
      const task = state.tasks.find((x) => x.id === action.taskId);
      if (!task || task.status === 'done') return state;
      if (task.dueDate && task.dueDate >= t && action.date > task.dueDate) return state;
      const tasks = state.tasks.map((x) =>
        x.id === action.taskId
          ? { ...x, scheduledDate: action.date, scheduledStart: null, scheduledEnd: null, generatedBy: 'manual' as const }
          : x,
      );
      return { ...state, tasks };
    }

    case 'RESCHEDULE':
      return generatePlan(state, t, action.reason).state;

    case 'RESCHEDULE_FROM':
      return generatePlan(state, action.fromDate, action.reason).state;

    case 'TODAY_IMPOSSIBLE': {
      // 今日の未着手タスクを全て外し、明日以降で全体再計算
      const tasks = state.tasks.map((x) =>
        x.scheduledDate === t && x.status === 'planned'
          ? { ...x, status: 'postponed' as const, scheduledDate: addDays(t, 1) }
          : x,
      );
      return generatePlan({ ...state, tasks }, addDays(t, 1), '「今日は無理」の指定').state;
    }

    case 'UPDATE_GOAL':
      return generatePlan({ ...state, goal: action.goal }, t, '試験日・目標の変更').state;

    case 'UPDATE_AVAILABILITY':
      return generatePlan({ ...state, availability: action.availability }, t, '勉強可能時間の変更').state;

    case 'UPDATE_DAY_PLAN': {
      const rest = state.dayPlans.filter((p) => p.date !== action.dayPlan.date);
      const dayPlans = [...rest, action.dayPlan].sort((a, b) => a.date.localeCompare(b.date));
      return { ...state, dayPlans };
    }

    case 'UPDATE_FIXED_EVENTS':
      return generatePlan({ ...state, fixedEvents: action.fixedEvents }, t, '固定予定の変更').state;

    case 'UPDATE_SETTINGS':
      return generatePlan({ ...state, settings: action.settings }, t, '設定の変更').state;

    case 'DISMISS_RESCHEDULE_BANNER':
      return { ...state, lastReschedule: null };

    default:
      return state;
  }
}

export function emptyState(): AppState {
  return {
    version: STATE_VERSION,
    isDemo: false,
    onboarded: false,
    goal: null,
    subjects: [],
    materials: [],
    tasks: [],
    sessions: [],
    availability: defaultAvailability(),
    dayPlans: [],
    fixedEvents: [],
    settings: defaultSettings(),
    lastReschedule: null,
    lastPlannedDate: null,
  };
}

// ============================================================
// Context
// ============================================================

export type SyncStatus = 'syncing' | 'synced' | 'offline' | 'error';

interface AppContextValue {
  state: AppState;
  dispatch: (action: Action) => void;
  syncStatus: SyncStatus;
}

const AppContext = createContext<AppContextValue | null>(null);

const DATA_PUSH_DEBOUNCE_MS = 900;

export function AppProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const owner = user?.username ?? null;

  // ログインユーザーとlocalStorageのキャッシュ持ち主が一致する(または、まだ誰の持ち物か
  // タグ付けされていない=アカウント制導入前からの既存データ)時だけローカルキャッシュを使う。
  // ログアウト時にキャッシュとタグは必ず一緒に消えるため、別ユーザーのデータが
  // 新しいユーザーに混ざることはない(共用端末でも安全)。
  const [state, dispatch] = useReducer(appReducer, undefined, () => {
    const savedOwner = getStateOwner();
    if (owner && (savedOwner === null || savedOwner === owner)) {
      return loadState() ?? emptyState();
    }
    return emptyState();
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const [syncReady, setSyncReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('syncing');
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPush = useRef(false);

  useEffect(() => {
    saveState(state);
    setStateOwner(owner);
  }, [state, owner]);

  // タブ非表示・終了時に即保存(iOS PWA対策)
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') saveStateNow(state);
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, [state]);

  // 初回ログイン時: D1に既存データがあればそれを正として読み込み、
  // なければ端末内の既存データをD1へ移行する
  useEffect(() => {
    if (!owner) return;
    let cancelled = false;
    setSyncReady(false);
    setSyncStatus('syncing');
    (async () => {
      try {
        const res = await apiGetData();
        if (cancelled) return;
        if (res.appState) {
          dispatch({ type: 'IMPORT_STATE', state: normalizeState(res.appState as AppState) });
        } else if (stateRef.current.onboarded) {
          await apiPutData(stateRef.current);
        }
        if (!cancelled) setSyncStatus('synced');
      } catch (e) {
        if (cancelled) return;
        const err = e as ApiError;
        setSyncStatus(err.isNetworkError ? 'offline' : 'error');
      } finally {
        if (!cancelled) setSyncReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  const pushToD1 = useCallback(async (nextState: AppState) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      pendingPush.current = true;
      setSyncStatus('offline');
      return;
    }
    try {
      await apiPutData(nextState);
      pendingPush.current = false;
      setSyncStatus('synced');
    } catch (e) {
      pendingPush.current = true;
      const err = e as ApiError;
      setSyncStatus(err.isNetworkError ? 'offline' : 'error');
    }
  }, []);

  // 状態変化をD1へデバウンス反映(オフライン時はlocalStorageのみに保存し、オンライン復帰後に再送)
  useEffect(() => {
    if (!syncReady || !owner) return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      pushToD1(stateRef.current);
    }, DATA_PUSH_DEBOUNCE_MS);
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [state, syncReady, owner, pushToD1]);

  useEffect(() => {
    const onOnline = () => {
      if (pendingPush.current) pushToD1(stateRef.current);
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [pushToD1]);

  const value = useMemo(() => ({ state, dispatch, syncStatus }), [state, syncStatus]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export function resetStorage(): void {
  clearState();
}
