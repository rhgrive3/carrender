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
import { generatePlan, normalizeUnitRanges, remainingUnitRanges, sumRangeLengths, updateMinutesPerUnitEstimate } from '../lib/scheduler';
import { generateReviewTasks } from '../lib/review';
import { addDays, genId, hmToMinutes, minutesToHM, today } from '../lib/date';
import { buildDemoState } from '../data/demo';
import { defaultSettings, defaultAvailability } from '../data/defaults';
import { useAuth } from './AuthContext';
import { apiGetData, apiPutData } from '../lib/api';
import type { ApiError } from '../lib/api';
import { compareTaskDisplayOrder, isPlacedPlanTask } from '../lib/taskFilters';

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
  | { type: 'UNLOCK_TASK'; taskId: string }
  | { type: 'RESCHEDULE'; reason: string }
  | { type: 'RESCHEDULE_FROM'; fromDate: ISODate; reason: string }
  | { type: 'TODAY_IMPOSSIBLE' }
  | { type: 'UPDATE_GOAL'; goal: UserGoal }
  | { type: 'UPDATE_AVAILABILITY'; availability: AvailabilitySlot[] }
  | { type: 'UPDATE_DAY_PLAN'; dayPlan: DayPlanOverride }
  | { type: 'UPDATE_DAY_MEMO'; date: ISODate; memo: string }
  | { type: 'UPDATE_FIXED_EVENTS'; fixedEvents: FixedEvent[] }
  | { type: 'UPDATE_SETTINGS'; settings: AppSettings }
  | { type: 'DISMISS_RESCHEDULE_BANNER' }
  | { type: 'CHECK_DATE_CHANGE' };

// ============================================================
// Reducer
// ============================================================

function takeFirstRanges(ranges: { start: number; end: number }[], amount: number) {
  const result: { start: number; end: number }[] = [];
  let left = amount;
  for (const range of ranges) {
    if (left <= 0) break;
    const take = Math.min(left, range.end - range.start + 1);
    result.push({ start: range.start, end: range.start + take - 1 });
    left -= take;
  }
  return result;
}

function intersectRanges(
  ranges: { start: number; end: number }[],
  limit: { start: number; end: number },
): { start: number; end: number }[] {
  return ranges.flatMap((range) => {
    const start = Math.max(range.start, limit.start);
    const end = Math.min(range.end, limit.end);
    return start <= end ? [{ start, end }] : [];
  });
}

/** 入力値を、対象教材・対象タスクで実際に完了可能な量へ正規化する。 */
export function resolveSessionProgress(state: AppState, input: SessionInput) {
  const requested = Math.max(0, Math.floor(Number.isFinite(input.amountDone) ? input.amountDone : 0));
  const material = input.materialId ? state.materials.find((item) => item.id === input.materialId) : undefined;
  if (!material) return { amountDone: requested, addedRanges: [] as { start: number; end: number }[] };

  const completed = normalizeUnitRanges(
    material.completedRanges ?? (material.doneAmount > 0 ? [{ start: 1, end: material.doneAmount }] : []),
    material.totalAmount,
  );
  const task = input.taskId ? state.tasks.find((item) => item.id === input.taskId) : undefined;
  const explicit = task?.materialRange
    ?? (task?.rangeStart !== null && task?.rangeStart !== undefined && task.rangeEnd !== null
      ? { start: task.rangeStart, end: task.rangeEnd }
      : undefined);
  let eligible = remainingUnitRanges(material.totalAmount, completed);
  if (explicit) eligible = intersectRanges(eligible, explicit);

  let remaining = sumRangeLengths(eligible);
  if (task && !explicit) remaining = Math.min(remaining, Math.max(0, task.amount));
  const amountDone = Math.min(input.completedTask && task ? remaining : requested, remaining);
  return { amountDone, addedRanges: takeFirstRanges(eligible, amountDone) };
}

function deferTask(task: StudyTask, date: ISODate): StudyTask {
  let manualScheduling = task.manualScheduling;
  let placementLock: StudyTask['placementLock'] = 'none';
  if (manualScheduling) {
    const canStayFlexible = manualScheduling.placementPolicy === 'flexibleBeforeDeadline'
      && !!manualScheduling.deadline
      && manualScheduling.deadline >= date;
    manualScheduling = canStayFlexible
      ? { ...manualScheduling, fixedDate: undefined, fixedStartTime: undefined }
      : {
          ...manualScheduling,
          placementPolicy: 'fixedDateFlexibleTime',
          fixedDate: date,
          fixedStartTime: undefined,
        };
    placementLock = canStayFlexible ? 'none' : 'date';
  }
  return {
    ...task,
    status: 'planned',
    scheduledDate: date,
    scheduledStart: null,
    scheduledEnd: null,
    placementLock,
    placementStatus: 'unscheduled',
    manualScheduling,
    manualOrder: undefined,
    updatedAt: new Date().toISOString(),
  };
}

function settingsAffectPlan(previous: AppSettings, next: AppSettings): boolean {
  return previous.maxDailyMinutes !== next.maxDailyMinutes
    || previous.sessionMinMinutes !== next.sessionMinMinutes
    || previous.sessionMaxMinutes !== next.sessionMaxMinutes
    || previous.timezone !== next.timezone
    || previous.taskGenerationHorizonDays !== next.taskGenerationHorizonDays
    || JSON.stringify(previous.reviewRule) !== JSON.stringify(next.reviewRule);
}

export function appReducer(state: AppState, action: Action): AppState {
  const t = today();
  switch (action.type) {
    case 'LOAD_DEMO':
      return buildDemoState();

    case 'RESET_ALL':
      return emptyState();

    case 'IMPORT_STATE':
      return action.state.lastPlannedDate === null
        || action.state.lastPlannedDate < t
        || action.state.tasks.some((task) => task.status === 'planned' && task.scheduledDate < t)
        ? generatePlan(action.state, t, '保存データ読込時の日付・未達成反映').state
        : { ...action.state };

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
        completedRanges: [],
        totalUnits: m.totalAmount,
        startDate: t,
        targetDate: m.targetDate,
        priority: 3,
        difficulty: 3,
        minutesPerUnit: m.minutesPerUnit,
        unitStep: 1,
        splittable: true,
        preferredCadence: { type: 'auto' },
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
      const completedRanges = action.material.completedRanges
        ?? (action.material.doneAmount > 0 ? [{ start: 1, end: action.material.doneAmount }] : []);
      const material = { ...action.material, totalUnits: action.material.totalUnits ?? action.material.totalAmount, completedRanges };
      const next = { ...state, materials: [...state.materials, material] };
      return generatePlan(next, t, `教材「${action.material.name}」の追加`).state;
    }

    case 'UPDATE_MATERIAL': {
      const previous = state.materials.find((m) => m.id === action.material.id);
      const completedRanges = !action.material.completedRanges || previous?.doneAmount !== action.material.doneAmount
        ? (action.material.doneAmount > 0 ? [{ start: 1, end: action.material.doneAmount }] : [])
        : action.material.completedRanges;
      const material = { ...action.material, totalUnits: action.material.totalAmount, completedRanges };
      const next = {
        ...state,
        materials: state.materials.map((m) => (m.id === action.material.id ? material : m)),
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

    case 'ADD_MANUAL_TASK': {
      const task = {
        ...action.task,
        sourceType: 'manual' as const,
        sourceId: action.task.sourceId ?? action.task.id,
        placementLock: action.task.placementLock ?? (action.task.scheduledStart ? 'time' as const : 'date' as const),
        placementStatus: action.task.scheduledStart ? 'scheduled' as const : 'unscheduled' as const,
        updatedAt: action.task.updatedAt ?? action.task.createdAt,
      };
      return generatePlan({ ...state, tasks: [...state.tasks, task] }, t, `手動タスク「${task.title}」の追加`).state;
    }

    case 'UPDATE_TASK': {
      const next = {
        ...state,
        tasks: state.tasks.map((x) => (x.id === action.task.id ? action.task : x)),
      };
      return generatePlan(next, t, `タスク「${action.task.title}」の変更`).state;
    }

    case 'DELETE_TASK': {
      const title = state.tasks.find((task) => task.id === action.taskId)?.title ?? '';
      return generatePlan({ ...state, tasks: state.tasks.filter((x) => x.id !== action.taskId) }, t, `タスク「${title}」の削除`).state;
    }

    case 'REORDER_TASK': {
      const task = state.tasks.find((x) => x.id === action.taskId);
      if (!task) return state;
      const list = state.tasks
        .filter((x) => x.scheduledDate === task.scheduledDate && x.status === 'planned' && isPlacedPlanTask(x))
        .sort(compareTaskDisplayOrder);
      const index = list.findIndex((x) => x.id === action.taskId);
      const target = action.direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= list.length) return state;
      const reordered = [...list];
      const [picked] = reordered.splice(index, 1);
      reordered.splice(target, 0, picked);
      const order = new Map(reordered.map((item, orderIndex) => [item.id, orderIndex]));
      return {
        ...state,
        tasks: state.tasks.map((x) => {
          const manualOrder = order.get(x.id);
          return manualOrder === undefined ? x : { ...x, manualOrder, updatedAt: new Date().toISOString() };
        }),
      };
    }

    case 'RECORD_SESSION': {
      const inp = action.input;
      const progress = resolveSessionProgress(state, inp);
      const session: StudySession = {
        id: genId('sess'),
        taskId: inp.taskId,
        subjectId: inp.subjectId,
        materialId: inp.materialId,
        date: t,
        startedAt: new Date().toISOString(),
        minutes: inp.minutes,
        amountDone: progress.amountDone,
        rangeLabel: inp.rangeLabel,
        focus: inp.focus,
        memo: inp.memo,
        source: inp.source,
      };

      // 教材進捗を更新
      let materials = state.materials;
      if (inp.materialId && progress.amountDone > 0) {
        materials = state.materials.map((m) => {
          if (m.id !== inp.materialId) return m;
          const completed = m.completedRanges ?? (m.doneAmount > 0 ? [{ start: 1, end: m.doneAmount }] : []);
          const merged = normalizeUnitRanges([...completed, ...progress.addedRanges], m.totalAmount);
          return { ...m, completedRanges: merged, doneAmount: sumRangeLengths(merged) };
        });
      }
      const sessions = [...state.sessions, session];
      materials = materials.map((material) => {
        if (material.id !== inp.materialId) return material;
        const estimate = updateMinutesPerUnitEstimate(material, sessions, state.settings.estimateAlpha ?? 0.2);
        return {
          ...material,
          minutesPerUnit: estimate.appliedEstimate,
          estimatedMinutesPerUnit: estimate.suggestedEstimate ?? material.estimatedMinutesPerUnit,
        };
      });

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
        sessions,
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
          x.id === action.taskId ? deferTask(x, addDays(t, 1)) : x,
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
          ? { ...x, scheduledDate: action.date, scheduledStart: null, scheduledEnd: null, placementLock: 'date' as const, placementStatus: 'unscheduled' as const, updatedAt: new Date().toISOString() }
          : x,
      );
      return generatePlan({ ...state, tasks }, t, `「${task.title}」の日付固定`).state;
    }

    case 'UNLOCK_TASK': {
      const task = state.tasks.find((item) => item.id === action.taskId);
      if (!task || task.status === 'done' || task.status === 'doing') return state;
      const tasks = state.tasks.map((item) => item.id === action.taskId
        ? { ...item, placementLock: 'none' as const, generatedBy: item.sourceType === 'manual' ? item.generatedBy : 'auto' as const, updatedAt: new Date().toISOString() }
        : item);
      return generatePlan({ ...state, tasks }, t, `「${task.title}」のロック解除`).state;
    }

    case 'RESCHEDULE':
      return generatePlan(state, t, action.reason).state;

    case 'RESCHEDULE_FROM':
      return generatePlan(state, action.fromDate, action.reason).state;

    case 'TODAY_IMPOSSIBLE': {
      // 今日の未着手タスクを全て外し、明日以降で全体再計算
      const tasks = state.tasks.map((x) =>
        x.scheduledDate === t && x.status === 'planned'
          ? deferTask(x, addDays(t, 1))
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
      return generatePlan({ ...state, dayPlans }, action.dayPlan.date < t ? t : action.dayPlan.date, '日別負荷・利用可能時間の変更').state;
    }

    case 'UPDATE_DAY_MEMO': {
      const current = state.dayPlans.find((plan) => plan.date === action.date);
      const dayPlan: DayPlanOverride = current
        ? { ...current, memo: action.memo }
        : { date: action.date, load: 'normal', memo: action.memo, availabilityWindows: null };
      const dayPlans = [...state.dayPlans.filter((plan) => plan.date !== action.date), dayPlan]
        .sort((a, b) => a.date.localeCompare(b.date));
      return { ...state, dayPlans };
    }

    case 'UPDATE_FIXED_EVENTS':
      return generatePlan({ ...state, fixedEvents: action.fixedEvents }, t, '固定予定の変更').state;

    case 'UPDATE_SETTINGS':
      return settingsAffectPlan(state.settings, action.settings)
        ? generatePlan({ ...state, settings: action.settings }, t, '計画設定の変更').state
        : { ...state, settings: action.settings };

    case 'DISMISS_RESCHEDULE_BANNER':
      return { ...state, lastReschedule: null };

    case 'CHECK_DATE_CHANGE':
      return state.lastPlannedDate === null
        || state.lastPlannedDate < t
        || state.tasks.some((task) => task.status === 'planned' && task.scheduledDate < t)
        ? generatePlan(state, t, '日付変更').state
        : state;

    default:
      return state;
  }
}

export function emptyState(): AppState {
  return {
    version: STATE_VERSION,
    schemaVersion: STATE_VERSION,
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
    lastScheduleResult: null,
    lastPlanReason: null,
  };
}

// ============================================================
// Context
// ============================================================

export type SyncStatus = 'syncing' | 'synced' | 'offline' | 'conflict' | 'error';

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
      const loaded = loadState();
      if (!loaded) return emptyState();
      const currentDate = today();
      return loaded.lastPlannedDate === null
        || loaded.lastPlannedDate < currentDate
        || loaded.tasks.some((task) => task.status === 'planned' && task.scheduledDate < currentDate)
        ? generatePlan(loaded, currentDate, '起動時の日付・未達成反映').state
        : loaded;
    }
    return emptyState();
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const [syncReady, setSyncReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('syncing');
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPush = useRef(false);
  const remoteUpdatedAt = useRef<string | null | undefined>(undefined);
  const pushChain = useRef<Promise<void>>(Promise.resolve());
  const syncConflict = useRef(false);

  useEffect(() => {
    if (!owner) return;
    saveState(state);
    setStateOwner(owner);
  }, [state, owner]);

  useEffect(() => {
    const checkDate = () => dispatch({ type: 'CHECK_DATE_CHANGE' });
    const timer = window.setInterval(checkDate, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') checkDate();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

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
    remoteUpdatedAt.current = undefined;
    pushChain.current = Promise.resolve();
    syncConflict.current = false;
    setSyncReady(false);
    setSyncStatus('syncing');
    (async () => {
      try {
        const res = await apiGetData();
        if (cancelled) return;
        remoteUpdatedAt.current = res.updatedAt;
        if (res.appState) {
          dispatch({ type: 'IMPORT_STATE', state: normalizeState(res.appState as AppState) });
        } else if (stateRef.current.onboarded) {
          const saved = await apiPutData(stateRef.current, null);
          remoteUpdatedAt.current = saved.updatedAt;
        }
        if (!cancelled) setSyncStatus('synced');
      } catch (e) {
        if (cancelled) return;
        const err = e as ApiError;
        if (err.status === 409) {
          syncConflict.current = true;
          setSyncStatus('conflict');
        } else {
          setSyncStatus(err.isNetworkError ? 'offline' : 'error');
        }
      } finally {
        if (!cancelled) setSyncReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  const pushToD1 = useCallback((nextState: AppState) => {
    pushChain.current = pushChain.current.then(async () => {
      if (syncConflict.current) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        pendingPush.current = true;
        setSyncStatus('offline');
        return;
      }
      try {
        const saved = await apiPutData(nextState, remoteUpdatedAt.current);
        remoteUpdatedAt.current = saved.updatedAt;
        pendingPush.current = false;
        setSyncStatus('synced');
      } catch (e) {
        const err = e as ApiError;
        if (err.status === 409) {
          syncConflict.current = true;
          pendingPush.current = false;
          setSyncStatus('conflict');
        } else {
          pendingPush.current = true;
          setSyncStatus(err.isNetworkError ? 'offline' : 'error');
        }
      }
    });
    return pushChain.current;
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
  if (owner && !syncReady) {
    return <div className="screen"><div className="card">クラウドの最新データを確認中…</div></div>;
  }
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
