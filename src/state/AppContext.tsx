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
import { loadState, saveState, saveStateNow, getStateOwner, setStateOwner, isAppStateShape, migrateState, STATE_VERSION, subscribeStateSaveFailure } from '../lib/storage';
import { generatePlan, normalizeUnitRanges, remainingUnitRanges, sumRangeLengths, updateMinutesPerUnitEstimate } from '../lib/scheduler';
import { generateReviewTasks } from '../lib/review';
import { addDays, genId, hmToMinutes, localDateTimeToISOString, minutesToHM, today } from '../lib/date';
import { buildDemoState } from '../data/demo';
import { defaultSettings, defaultAvailability } from '../data/defaults';
import { useAuth } from './AuthContext';
import { apiGetData, apiPutData } from '../lib/api';
import type { ApiError } from '../lib/api';
import { compareTaskDisplayOrder, isPlacedPlanTask } from '../lib/taskFilters';
import {
  decideInitialSync,
  getMainSyncMetadata,
  markMainSyncClean,
  markMainSyncDirty,
  saveMainSyncConflictBackup,
} from '../lib/mainSync';

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
  /** 手入力は過去日を指定できる。タイマー記録は省略して現在日時を使う。 */
  date?: ISODate;
  startTime?: string;
  /** 再計算で表示用IDが変わった時に、開始した作業を再解決するための手掛かり */
  taskLocator?: { sourceId?: string; range?: { start: number; end: number }; type?: StudyTask['type'] };
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
  | { type: 'DELETE_MATERIAL'; materialId: string; deleteSessions?: boolean }
  | { type: 'ADD_SUBJECT'; subject: Subject }
  | { type: 'UPDATE_SUBJECT'; subject: Subject }
  | { type: 'ADD_MANUAL_TASK'; task: StudyTask }
  | { type: 'UPDATE_TASK'; task: StudyTask }
  | { type: 'DELETE_TASK'; taskId: string }
  | { type: 'REORDER_TASK'; taskId: string; direction: 'up' | 'down' }
  | { type: 'RECORD_SESSION'; input: SessionInput }
  | { type: 'UPDATE_SESSION'; sessionId: string; input: SessionInput }
  | { type: 'DELETE_SESSION'; sessionId: string }
  | { type: 'POSTPONE_TASK'; taskId: string }
  | { type: 'MOVE_TASK'; taskId: string; date: ISODate }
  | { type: 'UNLOCK_TASK'; taskId: string }
  | { type: 'RESCHEDULE'; reason: string }
  | { type: 'RESCHEDULE_FROM'; fromDate: ISODate; reason: string }
  | { type: 'TODAY_IMPOSSIBLE' }
  | { type: 'UPDATE_GOAL'; goal: UserGoal }
  | { type: 'UPDATE_AVAILABILITY'; availability: AvailabilitySlot[] }
  | { type: 'UPDATE_DAY_PLAN'; dayPlan: DayPlanOverride }
  | { type: 'DELETE_DAY_PLAN'; date: ISODate }
  | { type: 'UPDATE_DAY_MEMO'; date: ISODate; memo: string }
  | { type: 'UPDATE_FIXED_EVENTS'; fixedEvents: FixedEvent[] }
  | { type: 'UPDATE_SETTINGS'; settings: AppSettings }
  | { type: 'DELETE_SUBJECT'; subjectId: string }
  | { type: 'MERGE_SUBJECT'; sourceId: string; targetId: string }
  | { type: 'REPLACE_STATE'; state: AppState }
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

/** 進捗量の編集時も既存の飛び飛び範囲を保ち、増減分だけを調整する。 */
export function adjustCompletedRanges(
  totalAmount: number,
  ranges: { start: number; end: number }[],
  requestedDoneAmount: number,
) {
  const total = Math.max(0, Math.floor(totalAmount));
  const desired = Math.max(0, Math.min(total, Math.floor(requestedDoneAmount)));
  let adjusted = normalizeUnitRanges(
    ranges.flatMap((range) => {
      const start = Math.max(1, Math.floor(range.start));
      const end = Math.min(total, Math.floor(range.end));
      return start <= end ? [{ start, end }] : [];
    }),
    total,
  );
  const current = sumRangeLengths(adjusted);
  if (desired > current) {
    const additions = takeFirstRanges(remainingUnitRanges(total, adjusted), desired - current);
    return normalizeUnitRanges([...adjusted, ...additions], total);
  }
  let remove = current - desired;
  if (remove <= 0) return adjusted;
  adjusted = adjusted.map((range) => ({ ...range }));
  for (let index = adjusted.length - 1; index >= 0 && remove > 0; index -= 1) {
    const range = adjusted[index];
    const length = range.end - range.start + 1;
    if (remove >= length) {
      adjusted.splice(index, 1);
      remove -= length;
    } else {
      range.end -= remove;
      remove = 0;
    }
  }
  return adjusted;
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
  const task = findCurrentTask(state, input);
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

/** タイマー開始後の再計算でIDが変わっても、同一の教材範囲・作業系列へ記録する。 */
function findCurrentTask(state: AppState, input: Pick<SessionInput, 'taskId' | 'taskLocator' | 'materialId'>): StudyTask | undefined {
  const exact = input.taskId ? state.tasks.find((item) => item.id === input.taskId) : undefined;
  if (exact) return exact;
  const locator = input.taskLocator;
  if (!locator?.sourceId) return undefined;
  return state.tasks.find((task) => {
    if (task.status === 'done' || task.sourceId !== locator.sourceId || task.materialId !== input.materialId) return false;
    if (locator.type && task.type !== locator.type) return false;
    if (!locator.range) return true;
    const range = task.materialRange
      ?? (Number.isFinite(task.rangeStart) && Number.isFinite(task.rangeEnd) ? { start: task.rangeStart!, end: task.rangeEnd! } : undefined);
    return range?.start === locator.range.start && range.end === locator.range.end;
  });
}

function deferTask(task: StudyTask, date: ISODate): StudyTask {
  let manualScheduling = task.manualScheduling;
  // 延期は「明日より前へ戻さない」という明示的な操作。自動教材・復習も
  // 日付ロックにして、全体再計算で今日へ吸い戻されないようにする。
  let placementLock: StudyTask['placementLock'] = 'date';
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
    placementLock = 'date';
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

function dateLockManualScheduling(task: StudyTask, date: ISODate) {
  if (!task.manualScheduling) return undefined;
  return {
    ...task.manualScheduling,
    placementPolicy: 'fixedDateFlexibleTime' as const,
    fixedDate: date,
    fixedStartTime: undefined,
  };
}

function unlockManualScheduling(task: StudyTask) {
  if (!task.manualScheduling) return undefined;
  return {
    ...task.manualScheduling,
    placementPolicy: 'flexibleBeforeDeadline' as const,
    fixedDate: undefined,
    fixedStartTime: undefined,
  };
}

/** 途中記録後の元タスクを、実際に未完了の範囲と時間へ縮める。 */
function shrinkTaskAfterProgress(task: StudyTask, material: Material | undefined, completedRanges: { start: number; end: number }[]) {
  const explicit = task.materialRange
    ?? (task.rangeStart !== null && task.rangeStart !== undefined && task.rangeEnd !== null && task.rangeEnd !== undefined
      ? { start: task.rangeStart, end: task.rangeEnd }
      : undefined);
  const originalAmount = Math.max(1, task.amount);
  const minutesPerAmount = task.estimatedMinutes / originalAmount;
  const now = new Date().toISOString();

  if (!material || !explicit) {
    const completed = Math.min(task.amount, sumRangeLengths(completedRanges));
    const amount = Math.max(0, task.amount - completed);
    if (amount <= 0) return [{ ...task, status: 'done' as const, completedAt: now }];
    return [{
      ...task,
      amount,
      estimatedMinutes: Math.max(1, Math.round(amount * minutesPerAmount)),
      scheduledEnd: task.scheduledStart
        ? minutesToHM(hmToMinutes(task.scheduledStart) + Math.max(1, Math.round(amount * minutesPerAmount)))
        : task.scheduledEnd,
      updatedAt: now,
    }];
  }

  const remaining = intersectRanges(remainingUnitRanges(material.totalAmount, completedRanges), explicit);
  if (remaining.length === 0) return [{ ...task, status: 'done' as const, completedAt: now }];
  let cursor = task.scheduledStart ? hmToMinutes(task.scheduledStart) : null;
  return remaining.map((range, index) => {
    const amount = range.end - range.start + 1;
    const estimatedMinutes = Math.max(1, Math.round(amount * minutesPerAmount));
    const scheduledStart = cursor === null ? task.scheduledStart : minutesToHM(cursor);
    const scheduledEnd = cursor === null ? task.scheduledEnd : minutesToHM(cursor + estimatedMinutes);
    if (cursor !== null) cursor += estimatedMinutes;
    return {
      ...task,
      id: index === 0 ? task.id : `${task.id}_remaining_${range.start}_${range.end}`,
      rangeStart: range.start,
      rangeEnd: range.end,
      materialRange: range,
      rangeLabel: range.start === range.end ? `${range.start}` : `${range.start}〜${range.end}`,
      amount,
      estimatedMinutes,
      scheduledStart,
      scheduledEnd,
      status: 'planned' as const,
      completedAt: null,
      updatedAt: now,
    };
  });
}

function settingsAffectPlan(previous: AppSettings, next: AppSettings): boolean {
  return previous.maxDailyMinutes !== next.maxDailyMinutes
    || previous.sessionMinMinutes !== next.sessionMinMinutes
    || previous.sessionMaxMinutes !== next.sessionMaxMinutes
    || previous.taskGenerationHorizonDays !== next.taskGenerationHorizonDays
    || JSON.stringify(previous.reviewRule) !== JSON.stringify(next.reviewRule);
}

function subtractRanges(ranges: { start: number; end: number }[], removals: { start: number; end: number }[]) {
  let current = normalizeUnitRanges(ranges, Number.MAX_SAFE_INTEGER);
  for (const removal of normalizeUnitRanges(removals, Number.MAX_SAFE_INTEGER)) {
    current = current.flatMap((range) => {
      if (removal.end < range.start || removal.start > range.end) return [range];
      return [
        ...(removal.start > range.start ? [{ start: range.start, end: removal.start - 1 }] : []),
        ...(removal.end < range.end ? [{ start: removal.end + 1, end: range.end }] : []),
      ];
    });
  }
  return current;
}

/**
 * 旧記録には由来範囲がないため、現在進捗から新形式記録の寄与だけを除いた値を
 * 互換基準として扱う。これにより旧進捗を推測で消さず、新記録は何度でも再構築できる。
 */
function rebuildMaterialProgress(material: Material, beforeSessions: StudySession[], nextSessions: StudySession[]): Material {
  const current = material.completedRanges ?? (material.doneAmount > 0 ? [{ start: 1, end: material.doneAmount }] : []);
  const beforeContributions = beforeSessions
    .filter((session) => session.materialId === material.id)
    .flatMap((session) => session.progressRangesAdded ?? []);
  const baseline = subtractRanges(current, beforeContributions);
  const nextContributions = nextSessions
    .filter((session) => session.materialId === material.id)
    .flatMap((session) => session.progressRangesAdded ?? []);
  const completedRanges = normalizeUnitRanges([...baseline, ...nextContributions], material.totalAmount);
  return { ...material, completedRanges, doneAmount: sumRangeLengths(completedRanges) };
}

function revertSessionEffects(state: AppState, session: StudySession): AppState {
  const sessions = state.sessions.filter((entry) => entry.id !== session.id);
  let tasks = state.tasks.filter((task) =>
    !(session.generatedReviewTaskIds ?? []).includes(task.id)
    && !(session.replacementTaskIds ?? []).includes(task.id),
  );
  if (session.taskSnapshotBefore) {
    tasks = [
      ...tasks.filter((task) => task.id !== session.taskSnapshotBefore!.id),
      session.taskSnapshotBefore,
    ];
  }
  let materials = state.materials.map((material) => rebuildMaterialProgress(material, state.sessions, sessions));
  materials = materials.map((material) => {
    const estimate = updateMinutesPerUnitEstimate(material, sessions, state.settings.estimateAlpha ?? 0.2);
    return { ...material, minutesPerUnit: estimate.appliedEstimate, estimatedMinutesPerUnit: estimate.suggestedEstimate ?? material.estimatedMinutesPerUnit };
  });
  return { ...state, sessions, materials, tasks };
}

function recordSession(state: AppState, inp: SessionInput, sessionId = genId('sess')): AppState {
  const t = today();
  const progress = resolveSessionProgress(state, inp);
  const currentTask = findCurrentTask(state, inp);
  const now = new Date().toISOString();
  let materials = state.materials;
  if (inp.materialId && progress.amountDone > 0) {
    materials = materials.map((material) => {
      if (material.id !== inp.materialId) return material;
      const completed = material.completedRanges ?? (material.doneAmount > 0 ? [{ start: 1, end: material.doneAmount }] : []);
      const merged = normalizeUnitRanges([...completed, ...progress.addedRanges], material.totalAmount);
      return { ...material, completedRanges: merged, doneAmount: sumRangeLengths(merged) };
    });
  }
  let tasks = state.tasks;
  let newReviews: StudyTask[] = [];
  let replacementTaskIds: string[] = [];
  if (currentTask && inp.completedTask && currentTask.status !== 'done') {
    tasks = tasks.map((task) => task.id === currentTask.id ? { ...task, status: 'done' as const, completedAt: now } : task);
    newReviews = generateReviewTasks({ ...state, materials }, currentTask, inp.date ?? t);
  } else if (currentTask && progress.amountDone > 0 && currentTask.status !== 'done') {
    const material = currentTask.materialId ? materials.find((item) => item.id === currentTask.materialId) : undefined;
    const completedRanges = material?.completedRanges ?? [];
    const replacements = shrinkTaskAfterProgress(currentTask, material, progress.addedRanges.length > 0 ? completedRanges : [{ start: 1, end: progress.amountDone }]);
    replacementTaskIds = replacements.map((task) => task.id);
    tasks = tasks.flatMap((task) => task.id === currentTask.id ? replacements : [task]);
  }
  const session: StudySession = {
    id: sessionId,
    taskId: currentTask?.id ?? inp.taskId,
    subjectId: inp.subjectId,
    materialId: inp.materialId,
    date: inp.date ?? t,
    startedAt: inp.date && inp.startTime ? localDateTimeToISOString(inp.date, inp.startTime) : now,
    minutes: inp.minutes,
    amountDone: progress.amountDone,
    rangeLabel: inp.rangeLabel,
    focus: inp.focus,
    memo: inp.memo,
    source: inp.source,
    progressRangesAdded: progress.addedRanges,
    taskSnapshotBefore: currentTask ? { ...currentTask } : undefined,
    generatedReviewTaskIds: newReviews.map((task) => task.id),
    replacementTaskIds,
    completedTask: Boolean(currentTask && inp.completedTask),
    updatedAt: now,
  };
  const sessions = [...state.sessions, session];
  materials = materials.map((material) => {
    if (material.id !== inp.materialId) return material;
    const estimate = updateMinutesPerUnitEstimate(material, sessions, state.settings.estimateAlpha ?? 0.2);
    return { ...material, minutesPerUnit: estimate.appliedEstimate, estimatedMinutesPerUnit: estimate.suggestedEstimate ?? material.estimatedMinutesPerUnit };
  });
  const replanned = generatePlan({ ...state, materials, tasks: [...tasks, ...newReviews], sessions }, addDays(t, 1), '学習実績の反映');
  return newReviews.length > 0 || (currentTask && !inp.completedTask)
    ? replanned.state
    : { ...replanned.state, lastReschedule: null };
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
      const subjects: Subject[] = (inp.subjects.length > 0 ? inp.subjects : [{ name: '未分類', color: '#6366f1', importance: 3 as const, weakness: 3 as const }]).map((subject) => ({
        id: genId('subj'),
        name: subject.name,
        color: subject.color,
        importance: subject.importance,
        weakness: subject.weakness,
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
        const requestedMinutes = wd === 0 || wd === 6 ? inp.weekendMinutes : inp.weekdayMinutes;
        const fallback = defaultSlots.find((slot) => slot.weekday === wd)!;
        const start = wd === 0 || wd === 6 ? '09:00' : '18:00';
        const startMin = hmToMinutes(start);
        // Availability windows do not cross midnight. Clamp malformed or old
        // onboarding input instead of producing an end time earlier than start.
        const minutes = Math.max(0, Math.min(Math.floor(requestedMinutes), 24 * 60 - 1 - startMin));
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
      if (state.goal && action.material.targetDate > state.goal.examDate) return state;
      const completedRanges = action.material.completedRanges
        ?? (action.material.doneAmount > 0 ? [{ start: 1, end: action.material.doneAmount }] : []);
      const material = { ...action.material, totalUnits: action.material.totalUnits ?? action.material.totalAmount, completedRanges };
      const next = { ...state, materials: [...state.materials, material] };
      return generatePlan(next, t, `教材「${action.material.name}」の追加`).state;
    }

    case 'UPDATE_MATERIAL': {
      if (state.goal && action.material.targetDate > state.goal.examDate) return state;
      const previous = state.materials.find((m) => m.id === action.material.id);
      const previousRanges = previous?.completedRanges
        ?? (previous && previous.doneAmount > 0 ? [{ start: 1, end: previous.doneAmount }] : []);
      const completedRanges = previous
        ? adjustCompletedRanges(action.material.totalAmount, previousRanges, action.material.doneAmount)
        : adjustCompletedRanges(action.material.totalAmount, action.material.completedRanges ?? [], action.material.doneAmount);
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
        tasks: state.tasks.filter((task) => action.deleteSessions ? task.materialId !== action.materialId : task.materialId !== action.materialId || task.status === 'done'),
        planHistory: action.deleteSessions
          ? (state.planHistory ?? []).filter((entry) => entry.materialId !== action.materialId)
          : state.planHistory,
        sessions: action.deleteSessions ? state.sessions.filter((session) => session.materialId !== action.materialId) : state.sessions,
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

    case 'DELETE_SUBJECT': {
      if (state.subjects.length <= 1) return state;
      const referenced = state.materials.some((item) => item.subjectId === action.subjectId)
        || state.tasks.some((item) => item.subjectId === action.subjectId)
        || (state.planHistory ?? []).some((item) => item.subjectId === action.subjectId)
        || state.sessions.some((item) => item.subjectId === action.subjectId);
      return referenced ? state : { ...state, subjects: state.subjects.filter((subject) => subject.id !== action.subjectId) };
    }

    case 'MERGE_SUBJECT': {
      if (action.sourceId === action.targetId || !state.subjects.some((subject) => subject.id === action.targetId)) return state;
      return generatePlan({
        ...state,
        subjects: state.subjects.filter((subject) => subject.id !== action.sourceId),
        materials: state.materials.map((item) => item.subjectId === action.sourceId ? { ...item, subjectId: action.targetId } : item),
        tasks: state.tasks.map((item) => item.subjectId === action.sourceId ? { ...item, subjectId: action.targetId } : item),
        planHistory: (state.planHistory ?? []).map((item) => item.subjectId === action.sourceId ? { ...item, subjectId: action.targetId } : item),
        sessions: state.sessions.map((item) => {
          const subjectId = item.subjectId === action.sourceId ? action.targetId : item.subjectId;
          const taskSnapshotBefore = item.taskSnapshotBefore?.subjectId === action.sourceId
            ? { ...item.taskSnapshotBefore, subjectId: action.targetId }
            : item.taskSnapshotBefore;
          return subjectId !== item.subjectId || taskSnapshotBefore !== item.taskSnapshotBefore
            ? { ...item, subjectId, taskSnapshotBefore, updatedAt: new Date().toISOString() }
            : item;
        }),
      }, t, '科目の統合').state;
    }

    case 'ADD_MANUAL_TASK': {
      const policy = action.task.manualScheduling?.placementPolicy;
      const task = {
        ...action.task,
        sourceType: 'manual' as const,
        sourceId: action.task.sourceId ?? action.task.id,
        placementLock: action.task.placementLock
          ?? (policy === 'fixedTime' ? 'time' as const : policy === 'fixedDateFlexibleTime' ? 'date' as const : 'none' as const),
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
      return recordSession(state, action.input);
    }

    case 'UPDATE_SESSION': {
      const previous = state.sessions.find((session) => session.id === action.sessionId);
      return previous ? recordSession(revertSessionEffects(state, previous), action.input, action.sessionId) : state;
    }

    case 'DELETE_SESSION': {
      const previous = state.sessions.find((session) => session.id === action.sessionId);
      return previous ? generatePlan(revertSessionEffects(state, previous), t, '学習記録の削除').state : state;
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
          ? {
              ...x,
              scheduledDate: action.date,
              scheduledStart: null,
              scheduledEnd: null,
              placementLock: 'date' as const,
              placementStatus: 'unscheduled' as const,
              manualScheduling: dateLockManualScheduling(x, action.date),
              updatedAt: new Date().toISOString(),
            }
          : x,
      );
      return generatePlan({ ...state, tasks }, t, `「${task.title}」の日付固定`).state;
    }

    case 'UNLOCK_TASK': {
      const task = state.tasks.find((item) => item.id === action.taskId);
      if (!task || task.status === 'done' || task.status === 'doing') return state;
      const tasks = state.tasks.map((item) => item.id === action.taskId
        ? {
            ...item,
            placementLock: 'none' as const,
            manualScheduling: unlockManualScheduling(item),
            generatedBy: item.sourceType === 'manual' ? item.generatedBy : 'auto' as const,
            updatedAt: new Date().toISOString(),
          }
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
      if (state.materials.some((material) => !material.archived && material.targetDate > action.goal.examDate)) return state;
      return generatePlan({ ...state, goal: action.goal }, t, '試験日・目標の変更').state;

    case 'UPDATE_AVAILABILITY':
      return generatePlan({ ...state, availability: action.availability }, t, '勉強可能時間の変更').state;

    case 'UPDATE_DAY_PLAN': {
      const rest = state.dayPlans.filter((p) => p.date !== action.dayPlan.date);
      const dayPlans = [...rest, action.dayPlan].sort((a, b) => a.date.localeCompare(b.date));
      return generatePlan({ ...state, dayPlans }, action.dayPlan.date < t ? t : action.dayPlan.date, '日別負荷・利用可能時間の変更').state;
    }

    case 'DELETE_DAY_PLAN':
      return generatePlan({ ...state, dayPlans: state.dayPlans.filter((plan) => plan.date !== action.date) }, action.date < t ? t : action.date, '日別例外の削除').state;

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

    case 'REPLACE_STATE':
      return action.state;

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
    planHistory: [],
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

export interface MainSyncConflict {
  remoteState: AppState;
  remoteUpdatedAt: string;
  localBaseUpdatedAt: string | null;
}

export interface AppCommandResult {
  changed: boolean;
  scheduleStatus?: import('../types').ScheduleGenerationStatus;
  message?: string;
  errorCode?: string;
}

const UNDO_LABELS: Partial<Record<Action['type'], string>> = {
  TODAY_IMPOSSIBLE: '今日の再配置を元に戻す',
  POSTPONE_TASK: 'タスクの延期を元に戻す',
  MOVE_TASK: 'タスクの移動を元に戻す',
  RESCHEDULE: '再設計を元に戻す',
  DELETE_TASK: 'タスク削除を元に戻す',
  DELETE_MATERIAL: '教材削除を元に戻す',
  UPDATE_AVAILABILITY: '勉強可能時間を元に戻す',
  DELETE_DAY_PLAN: '日別例外削除を元に戻す',
  DELETE_SUBJECT: '科目削除を元に戻す',
  MERGE_SUBJECT: '科目統合を元に戻す',
};
export const UNDO_WINDOW_MS = 15_000;
export interface UndoEntry { state: AppState; label: string; expiresAt: number }
export function createUndoEntry(state: AppState, label: string, now = Date.now()): UndoEntry {
  return { state, label, expiresAt: now + UNDO_WINDOW_MS };
}
export function isUndoEntryValid(entry: UndoEntry, now = Date.now()): boolean {
  return now <= entry.expiresAt;
}

interface AppContextValue {
  state: AppState;
  dispatch: (action: Action) => void;
  execute: (action: Action) => AppCommandResult;
  syncStatus: SyncStatus;
  syncConflict: MainSyncConflict | null;
  hasUnsyncedChanges: boolean;
  resolveSyncConflict: (choice: 'local' | 'cloud') => Promise<void>;
  retrySync: () => void;
  localSaveError: string | null;
}

const AppContext = createContext<AppContextValue | null>(null);

const DATA_PUSH_DEBOUNCE_MS = 900;

function normalizeCloudState(value: unknown): AppState {
  if (!isAppStateShape(value)) throw new Error('クラウドの学習データ形式が正しくありません');
  const migration = migrateState(value);
  if (!migration.ok) {
    throw new Error(`クラウドデータを移行できません: ${migration.errors.map((error) => `${error.targetId}.${error.field}`).join(', ')}`);
  }
  return migration.state;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const owner = user?.username ?? null;

  // ログインユーザーとlocalStorageのキャッシュ持ち主が一致する(または、まだ誰の持ち物か
  // タグ付けされていない=アカウント制導入前からの既存データ)時だけローカルキャッシュを使う。
  // ログアウト時にキャッシュとタグは必ず一緒に消えるため、別ユーザーのデータが
  // 新しいユーザーに混ざることはない(共用端末でも安全)。
  const [state, reducerDispatch] = useReducer(appReducer, undefined, () => {
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
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [undoEntry, setUndoEntry] = useState<UndoEntry | null>(null);
  const [undoNotice, setUndoNotice] = useState<string | null>(null);
  const rememberUndo = useCallback((action: Action, previous: AppState) => {
    const label = UNDO_LABELS[action.type]
      ?? (action.type === 'UPDATE_MATERIAL' && action.material.archived ? '教材アーカイブを元に戻す' : undefined);
    if (!label) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoEntry(createUndoEntry(previous, label));
    undoTimer.current = setTimeout(() => setUndoEntry(null), UNDO_WINDOW_MS);
  }, []);
  const dispatch = useCallback((action: Action) => {
    if (action.type === 'IMPORT_STATE' || action.type === 'RESET_ALL') {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndoEntry(null);
    }
    const previous = stateRef.current;
    const next = appReducer(previous, action);
    if (next === previous) return;
    rememberUndo(action, previous);
    // 同一イベント内で複数コマンドが続いても、2件目が古いReact stateを基準にしない。
    stateRef.current = next;
    reducerDispatch({ type: 'REPLACE_STATE', state: next });
  }, [rememberUndo]);
  const execute = useCallback((action: Action): AppCommandResult => {
    const previous = stateRef.current;
    const next = appReducer(previous, action);
    const changed = next !== previous;
    const schedule = next.lastScheduleResult !== previous.lastScheduleResult ? next.lastScheduleResult : undefined;
    const rejected = schedule?.status === 'invalidInput';
    if (changed && !rejected) {
      rememberUndo(action, previous);
      stateRef.current = next;
      reducerDispatch({ type: 'REPLACE_STATE', state: next });
    }
    const status = schedule?.status;
    return {
      changed: changed && !rejected,
      ...(status ? { scheduleStatus: status } : {}),
      ...(status === 'invalidInput' ? { message: schedule?.validationErrors?.[0]?.reason ?? '入力内容を確認してください', errorCode: 'invalidInput' } : {}),
      ...(status === 'partial' ? { message: '保存しましたが、一部のタスクは未配置です' } : {}),
      ...(status === 'conflict' ? { message: '保存しましたが、固定条件に競合があります' } : {}),
      ...(status === 'infeasible' ? { message: '保存しましたが、期限内に全量を配置できません' } : {}),
      ...(status === 'indeterminate' ? { message: '保存しましたが、配置可能性を確定できませんでした' } : {}),
    };
  }, [rememberUndo]);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);
  const skipInitialLocalWrite = useRef(true);
  const lastLocallyTrackedState = useRef(state);
  const [syncReady, setSyncReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('syncing');
  const [localSaveError, setLocalSaveError] = useState<string | null>(null);
  const [syncConflictInfo, setSyncConflictInfo] = useState<MainSyncConflict | null>(null);
  const [hasUnsyncedChanges, setHasUnsyncedChanges] = useState(false);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPush = useRef(false);
  const remoteUpdatedAt = useRef<string | null | undefined>(undefined);
  const pushChain = useRef<Promise<void>>(Promise.resolve());
  const syncConflict = useRef(false);
  const remoteKnown = useRef(false);
  const skipNextRemotePush = useRef(false);
  const skipNextLocalDirty = useRef(false);
  const [syncAttempt, setSyncAttempt] = useState(0);

  useEffect(() => subscribeStateSaveFailure((failure) => setLocalSaveError(failure?.message ?? null)), []);

  const markLocalClean = useCallback((updatedAt: string | null) => {
    if (owner) markMainSyncClean(owner, updatedAt);
    setHasUnsyncedChanges(false);
  }, [owner]);

  const markLocalDirty = useCallback(() => {
    if (!owner) return;
    const stored = getMainSyncMetadata(owner);
    const base = remoteUpdatedAt.current !== undefined
      ? remoteUpdatedAt.current
      : stored?.baseUpdatedAt ?? null;
    markMainSyncDirty(owner, base);
    setHasUnsyncedChanges(true);
  }, [owner]);

  const finishSuccessfulPush = useCallback((snapshot: AppState, updatedAt: string) => {
    remoteUpdatedAt.current = updatedAt;
    remoteKnown.current = true;
    syncConflict.current = false;
    setSyncConflictInfo(null);
    // A newer local edit may have landed while this request was in flight. In
    // that case the saved generation becomes the new base, but the device must
    // remain dirty until the newer snapshot is sent.
    if (stateRef.current === snapshot) {
      pendingPush.current = false;
      markLocalClean(updatedAt);
      setSyncStatus('synced');
    } else {
      pendingPush.current = true;
      if (owner) {
        markMainSyncClean(owner, updatedAt);
        markMainSyncDirty(owner, updatedAt);
      }
      setHasUnsyncedChanges(true);
      setSyncStatus('syncing');
    }
  }, [markLocalClean, owner]);

  const establishConflict = useCallback((appState: unknown, updatedAt: string | null, localBaseUpdatedAt: string | null) => {
    if (!updatedAt) throw new Error('クラウド側の更新世代を確認できません');
    const remoteState = normalizeCloudState(appState);
    remoteUpdatedAt.current = updatedAt;
    remoteKnown.current = true;
    pendingPush.current = true;
    syncConflict.current = true;
    setSyncConflictInfo({ remoteState, remoteUpdatedAt: updatedAt, localBaseUpdatedAt });
    setHasUnsyncedChanges(true);
    setSyncStatus('conflict');
  }, []);

  const applyCloudState = useCallback((remoteState: AppState, updatedAt: string) => {
    skipNextLocalDirty.current = true;
    skipNextRemotePush.current = true;
    dispatch({ type: 'IMPORT_STATE', state: remoteState });
    saveStateNow(stateRef.current);
    lastLocallyTrackedState.current = stateRef.current;
    remoteUpdatedAt.current = updatedAt;
    remoteKnown.current = true;
    pendingPush.current = false;
    syncConflict.current = false;
    setSyncConflictInfo(null);
    markLocalClean(updatedAt);
    setSyncStatus('synced');
  }, [dispatch, markLocalClean]);

  const pushToD1 = useCallback((nextState: AppState) => {
    pushChain.current = pushChain.current.then(async () => {
      if (syncConflict.current) return;
      if (!remoteKnown.current) {
        pendingPush.current = true;
        setSyncStatus(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error');
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        pendingPush.current = true;
        setSyncStatus('offline');
        return;
      }
      try {
        const saved = await apiPutData(nextState, remoteUpdatedAt.current);
        finishSuccessfulPush(nextState, saved.updatedAt);
      } catch (caught) {
        const error = caught as ApiError;
        pendingPush.current = true;
        if (error.status === 409) {
          try {
            const latest = await apiGetData();
            const metadata = owner ? getMainSyncMetadata(owner) : null;
            if (latest.appState) establishConflict(latest.appState, latest.updatedAt, metadata?.baseUpdatedAt ?? null);
            else setSyncStatus('error');
          } catch (refreshError) {
            const refresh = refreshError as ApiError;
            setSyncStatus(refresh.isNetworkError ? 'offline' : 'error');
          }
        } else {
          setSyncStatus(error.isNetworkError ? 'offline' : 'error');
        }
      }
    });
    return pushChain.current;
  }, [establishConflict, finishSuccessfulPush, owner]);

  useEffect(() => {
    if (!owner) return;
    if (skipInitialLocalWrite.current) {
      skipInitialLocalWrite.current = false;
      setStateOwner(owner);
      setHasUnsyncedChanges(getMainSyncMetadata(owner)?.dirty ?? false);
      lastLocallyTrackedState.current = state;
      return;
    }
    saveState(state);
    setStateOwner(owner);
    if (skipNextLocalDirty.current) {
      skipNextLocalDirty.current = false;
      lastLocallyTrackedState.current = state;
      return;
    }
    markLocalDirty();
    lastLocallyTrackedState.current = state;
  }, [markLocalDirty, owner, state]);

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
  }, [dispatch]);

  // iOS PWA may suspend the page before debounced effects run. Persist the
  // latest reducer snapshot and durable dirty marker from refs on pagehide.
  useEffect(() => {
    const onHide = () => {
      const current = stateRef.current;
      saveStateNow(current);
      if (current !== lastLocallyTrackedState.current && !skipNextLocalDirty.current) {
        markLocalDirty();
        lastLocallyTrackedState.current = current;
      }
      if (remoteKnown.current && syncReady && !syncConflict.current) void pushToD1(current);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
    };
  }, [markLocalDirty, pushToD1, syncReady]);

  // Startup reconciliation. A durable dirty snapshot is never replaced by a
  // different remote generation without an explicit user choice.
  useEffect(() => {
    if (!owner) return;
    let cancelled = false;
    remoteUpdatedAt.current = undefined;
    remoteKnown.current = false;
    pushChain.current = Promise.resolve();
    syncConflict.current = false;
    setSyncConflictInfo(null);
    setSyncReady(false);
    setSyncStatus('syncing');
    (async () => {
      try {
        const response = await apiGetData();
        if (cancelled) return;
        remoteUpdatedAt.current = response.updatedAt;
        remoteKnown.current = true;
        const metadata = getMainSyncMetadata(owner);
        const localState = stateRef.current;
        const decision = decideInitialSync({
          metadata,
          remoteUpdatedAt: response.updatedAt,
          hasRemoteState: Boolean(response.appState),
          hasLocalState: localState.onboarded,
        });

        if (decision === 'useRemote') {
          applyCloudState(normalizeCloudState(response.appState), response.updatedAt!);
        } else if (decision === 'pushLocal') {
          if (localState.onboarded) {
            const saved = await apiPutData(localState, response.updatedAt);
            finishSuccessfulPush(localState, saved.updatedAt);
            skipNextRemotePush.current = stateRef.current === localState;
          } else {
            markLocalClean(response.updatedAt);
            pendingPush.current = false;
            skipNextRemotePush.current = true;
            setSyncStatus('synced');
          }
        } else if (decision === 'conflict') {
          establishConflict(response.appState, response.updatedAt, metadata?.baseUpdatedAt ?? null);
        } else {
          markLocalClean(null);
          pendingPush.current = false;
          skipNextRemotePush.current = true;
          setSyncStatus('synced');
        }
      } catch (caught) {
        if (cancelled) return;
        const error = caught as ApiError;
        if (error.status === 409) {
          try {
            const latest = await apiGetData();
            const metadata = getMainSyncMetadata(owner);
            if (latest.appState) establishConflict(latest.appState, latest.updatedAt, metadata?.baseUpdatedAt ?? null);
            else setSyncStatus('error');
          } catch (refreshError) {
            const refresh = refreshError as ApiError;
            setSyncStatus(refresh.isNetworkError ? 'offline' : 'error');
          }
        } else {
          setSyncStatus(error.isNetworkError ? 'offline' : 'error');
        }
      } finally {
        if (!cancelled) setSyncReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyCloudState, establishConflict, finishSuccessfulPush, markLocalClean, owner, syncAttempt]);

  useEffect(() => {
    if (!syncReady || !owner || syncConflict.current) return;
    if (skipNextRemotePush.current) {
      skipNextRemotePush.current = false;
      return;
    }
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      void pushToD1(stateRef.current);
    }, DATA_PUSH_DEBOUNCE_MS);
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [owner, pushToD1, state, syncReady]);

  useEffect(() => {
    const onOnline = () => {
      if (syncConflict.current) return;
      if (!remoteKnown.current) setSyncAttempt((attempt) => attempt + 1);
      else if (pendingPush.current) void pushToD1(stateRef.current);
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [pushToD1]);

  const resolveSyncConflict = useCallback(async (choice: 'local' | 'cloud') => {
    const conflict = syncConflictInfo;
    if (!owner || !conflict) return;
    saveMainSyncConflictBackup({
      owner,
      createdAt: new Date().toISOString(),
      localBaseUpdatedAt: conflict.localBaseUpdatedAt,
      remoteUpdatedAt: conflict.remoteUpdatedAt,
      localState: stateRef.current,
      remoteState: conflict.remoteState,
    });
    setSyncStatus('syncing');
    if (choice === 'cloud') {
      applyCloudState(conflict.remoteState, conflict.remoteUpdatedAt);
      return;
    }
    try {
      const snapshot = stateRef.current;
      const saved = await apiPutData(snapshot, conflict.remoteUpdatedAt);
      finishSuccessfulPush(snapshot, saved.updatedAt);
    } catch (caught) {
      const error = caught as ApiError;
      if (error.status === 409) {
        const latest = await apiGetData();
        const metadata = getMainSyncMetadata(owner);
        if (latest.appState) establishConflict(latest.appState, latest.updatedAt, metadata?.baseUpdatedAt ?? null);
      } else {
        setSyncStatus(error.isNetworkError ? 'offline' : 'error');
      }
      throw caught;
    }
  }, [applyCloudState, establishConflict, finishSuccessfulPush, owner, syncConflictInfo]);

  const retrySync = useCallback(() => setSyncAttempt((attempt) => attempt + 1), []);

  const value = useMemo(() => ({ state, dispatch, execute, syncStatus, syncConflict: syncConflictInfo, hasUnsyncedChanges, resolveSyncConflict, retrySync, localSaveError }), [state, dispatch, execute, syncStatus, syncConflictInfo, hasUnsyncedChanges, resolveSyncConflict, retrySync, localSaveError]);
  if (owner && !syncReady) {
    return <div className="screen"><div className="card">クラウドの最新データを確認中…</div></div>;
  }
  return <AppContext.Provider value={value}>
    {children}
    {localSaveError && <div className="toast undo-notice" role="alert">{localSaveError}</div>}
    {undoEntry && isUndoEntryValid(undoEntry) && (
      <div className="toast undo-toast" role="status">
        <span>{undoEntry.label}</span>
        <button type="button" onClick={() => {
          if (!isUndoEntryValid(undoEntry)) { setUndoEntry(null); setUndoNotice('元に戻せる時間が過ぎています'); return; }
          stateRef.current = undoEntry.state;
          reducerDispatch({ type: 'REPLACE_STATE', state: undoEntry.state });
          setUndoEntry(null);
          setUndoNotice('元に戻しました');
          window.setTimeout(() => setUndoNotice(null), 2400);
          if (undoTimer.current) clearTimeout(undoTimer.current);
        }}>元に戻す</button>
      </div>
    )}
    {undoNotice && <div className="toast undo-notice" role="status">{undoNotice}</div>}
  </AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
