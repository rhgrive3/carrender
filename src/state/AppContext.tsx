import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';
import type {
  AppState,
  AppSettings,
  AvailabilitySlot,
  FixedEvent,
  ISODate,
  Material,
  StudySession,
  StudyTask,
  Subject,
  UserGoal,
} from '../types';
import { loadState, saveState, saveStateNow, clearState } from '../lib/storage';
import { generatePlan } from '../lib/scheduler';
import { generateReviewTasks } from '../lib/review';
import { addDays, genId, today } from '../lib/date';
import { buildDemoState } from '../data/demo';
import { defaultSettings, defaultAvailability } from '../data/defaults';

// ============================================================
// アクション定義
// ============================================================

export interface SessionInput {
  taskId: string | null;
  subjectId: string;
  materialId: string | null;
  minutes: number;
  amountDone: number;
  accuracy: number | null;
  focus: 1 | 2 | 3 | 4 | 5 | null;
  difficulty: 1 | 2 | 3 | 4 | 5 | null;
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

type Action =
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
  | { type: 'RECORD_SESSION'; input: SessionInput }
  | { type: 'SET_TASK_STATUS'; taskId: string; status: StudyTask['status'] }
  | { type: 'POSTPONE_TASK'; taskId: string }
  | { type: 'MOVE_TASK'; taskId: string; date: ISODate }
  | { type: 'RESCHEDULE'; reason: string }
  | { type: 'TODAY_IMPOSSIBLE' }
  | { type: 'UPDATE_GOAL'; goal: UserGoal }
  | { type: 'UPDATE_AVAILABILITY'; availability: AvailabilitySlot[] }
  | { type: 'UPDATE_FIXED_EVENTS'; fixedEvents: FixedEvent[] }
  | { type: 'UPDATE_SETTINGS'; settings: AppSettings }
  | { type: 'DISMISS_RESCHEDULE_BANNER' };

// ============================================================
// Reducer
// ============================================================

function reducer(state: AppState, action: Action): AppState {
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
        targetDate: m.targetDate,
        priority: 3,
        difficulty: 3,
        minutesPerUnit: m.minutesPerUnit,
        round: 1,
        lastStudiedAt: null,
        nextReviewAt: null,
        archived: false,
        createdAt: new Date().toISOString(),
      }));
      const availability: AvailabilitySlot[] = ([0, 1, 2, 3, 4, 5, 6] as const).map((wd) => ({
        weekday: wd,
        minutes: wd === 0 || wd === 6 ? inp.weekendMinutes : inp.weekdayMinutes,
      }));
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
        accuracy: inp.accuracy,
        focus: inp.focus,
        difficulty: inp.difficulty,
        memo: inp.memo,
        source: inp.source,
      };

      // 教材進捗を更新
      let materials = state.materials;
      if (inp.materialId && inp.amountDone > 0) {
        materials = state.materials.map((m) =>
          m.id === inp.materialId
            ? {
                ...m,
                doneAmount: Math.min(m.totalAmount, m.doneAmount + inp.amountDone),
                lastStudiedAt: t,
              }
            : m,
        );
      }

      // タスク完了処理 + 復習タスク生成
      let tasks = state.tasks;
      let newReviews: StudyTask[] = [];
      const task = inp.taskId ? state.tasks.find((x) => x.id === inp.taskId) : undefined;
      if (task && inp.completedTask) {
        tasks = tasks.map((x) =>
          x.id === task.id ? { ...x, status: 'done' as const, completedAt: new Date().toISOString() } : x,
        );
        newReviews = generateReviewTasks({ ...state, materials }, task, session, t);
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

    case 'SET_TASK_STATUS': {
      const tasks = state.tasks.map((x) =>
        x.id === action.taskId
          ? { ...x, status: action.status, completedAt: action.status === 'done' ? new Date().toISOString() : x.completedAt }
          : x,
      );
      return { ...state, tasks };
    }

    case 'POSTPONE_TASK': {
      const task = state.tasks.find((x) => x.id === action.taskId);
      if (!task) return state;
      const next = {
        ...state,
        tasks: state.tasks.map((x) =>
          x.id === action.taskId ? { ...x, status: 'postponed' as const, scheduledDate: addDays(t, 1) } : x,
        ),
      };
      return generatePlan(next, addDays(t, 1), `「${task.title}」の延期`).state;
    }

    case 'MOVE_TASK': {
      const tasks = state.tasks.map((x) =>
        x.id === action.taskId
          ? { ...x, scheduledDate: action.date, scheduledStart: null, scheduledEnd: null, generatedBy: 'manual' as const }
          : x,
      );
      return { ...state, tasks };
    }

    case 'RESCHEDULE':
      return generatePlan(state, t, action.reason).state;

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

    case 'UPDATE_FIXED_EVENTS':
      return generatePlan({ ...state, fixedEvents: action.fixedEvents }, t, '固定予定の変更').state;

    case 'UPDATE_SETTINGS':
      return { ...state, settings: action.settings };

    case 'DISMISS_RESCHEDULE_BANNER':
      return { ...state, lastReschedule: null };

    default:
      return state;
  }
}

export function emptyState(): AppState {
  return {
    version: 1,
    isDemo: false,
    onboarded: false,
    goal: null,
    subjects: [],
    materials: [],
    tasks: [],
    sessions: [],
    availability: defaultAvailability(),
    fixedEvents: [],
    settings: defaultSettings(),
    lastReschedule: null,
    lastPlannedDate: null,
  };
}

// ============================================================
// Context
// ============================================================

interface AppContextValue {
  state: AppState;
  dispatch: (action: Action) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => loadState() ?? emptyState());

  useEffect(() => {
    saveState(state);
  }, [state]);

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

  const value = useMemo(() => ({ state, dispatch }), [state]);
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
