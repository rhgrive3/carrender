import type { AppState, ISODate, StudyTask } from '../types';
import type { HistoricalMonthSummary } from './historyRetention';

export interface PlanRevisionTaskPlacement {
  key: string;
  taskId: string;
  title: string;
  materialId: string | null;
  estimatedMinutes: number;
  scheduledDate: ISODate;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  placementStatus?: StudyTask['placementStatus'];
  placementLock?: StudyTask['placementLock'];
  manualOrder?: number;
}

export interface PlanRevisionChange {
  key: string;
  taskId: string;
  title: string;
  materialId: string | null;
  kind: 'added' | 'removed' | 'moved' | 'updated';
  before?: PlanRevisionTaskPlacement;
  after?: PlanRevisionTaskPlacement;
}

export interface PlanRevisionMaterialChange {
  materialId: string;
  changedTasks: number;
  movedTasks: number;
  beforeMinutes: number;
  afterMinutes: number;
}

export interface PlanRevision {
  id: string;
  generationId: string;
  createdAt: string;
  reason: string;
  fromDate: ISODate;
  placements: PlanRevisionTaskPlacement[];
  changes: PlanRevisionChange[];
  materialChanges: PlanRevisionMaterialChange[];
}

type SettingsWithHistory = AppState['settings'] & {
  historyData?: {
    planRevisions: PlanRevision[];
    monthlySummaries: HistoricalMonthSummary[];
  };
};

const PLAN_REVISION_RETENTION_DAYS = 365;
const PLAN_REVISION_DENSE_DAYS = 14;
const PLAN_REVISION_MAX_COUNT = 32;

function taskStableKey(task: Pick<StudyTask, 'id' | 'sourceType' | 'sourceId' | 'materialId' | 'type' | 'materialRange' | 'rangeStart' | 'rangeEnd'>): string {
  const range = task.materialRange
    ?? (task.rangeStart !== null && task.rangeEnd !== null ? { start: task.rangeStart, end: task.rangeEnd } : undefined);
  return [
    task.sourceType ?? 'unknown',
    task.sourceId ?? task.id,
    task.materialId ?? '',
    task.type,
    range ? `${range.start}-${range.end}` : '',
  ].join('|');
}

function placement(task: StudyTask): PlanRevisionTaskPlacement {
  return {
    key: taskStableKey(task),
    taskId: task.id,
    title: task.title,
    materialId: task.materialId,
    estimatedMinutes: task.estimatedMinutes,
    scheduledDate: task.scheduledDate,
    scheduledStart: task.scheduledStart,
    scheduledEnd: task.scheduledEnd,
    placementStatus: task.placementStatus,
    placementLock: task.placementLock,
    manualOrder: task.manualOrder,
  };
}

function activePlanTasks(tasks: StudyTask[]): StudyTask[] {
  return tasks.filter((task) => task.status !== 'done' && task.status !== 'skipped');
}

function samePlacement(left: PlanRevisionTaskPlacement | undefined, right: PlanRevisionTaskPlacement | undefined): boolean {
  if (!left || !right) return left === right;
  return left.scheduledDate === right.scheduledDate
    && left.scheduledStart === right.scheduledStart
    && left.scheduledEnd === right.scheduledEnd
    && left.placementStatus === right.placementStatus
    && left.placementLock === right.placementLock
    && left.manualOrder === right.manualOrder
    && left.estimatedMinutes === right.estimatedMinutes;
}

function changeKind(before: PlanRevisionTaskPlacement | undefined, after: PlanRevisionTaskPlacement | undefined): PlanRevisionChange['kind'] {
  if (!before) return 'added';
  if (!after) return 'removed';
  if (before.scheduledDate !== after.scheduledDate || before.scheduledStart !== after.scheduledStart || before.scheduledEnd !== after.scheduledEnd) return 'moved';
  return 'updated';
}

function parseDate(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function compactPlanRevisions(revisions: PlanRevision[], now: Date): PlanRevision[] {
  const cutoff = now.getTime() - PLAN_REVISION_RETENTION_DAYS * 86_400_000;
  const denseCutoff = now.getTime() - PLAN_REVISION_DENSE_DAYS * 86_400_000;
  const sorted = [...new Map(revisions.map((revision) => [revision.id, revision])).values()]
    .filter((revision) => parseDate(revision.createdAt) >= cutoff)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const byMonth = new Map<string, PlanRevision>();
  const dense: PlanRevision[] = [];
  for (const revision of sorted) {
    if (parseDate(revision.createdAt) >= denseCutoff) dense.push(revision);
    else byMonth.set(revision.createdAt.slice(0, 7), revision);
  }
  return [...byMonth.values(), ...dense]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-PLAN_REVISION_MAX_COUNT);
}

export function capturePlanRevision(input: {
  before: AppState;
  after: AppState;
  generationId: string;
  reason: string;
  fromDate: ISODate;
  createdAt: string;
}): PlanRevision {
  const beforePlacements = activePlanTasks(input.before.tasks).map(placement);
  const afterPlacements = activePlanTasks(input.after.tasks).map(placement);
  const beforeByKey = new Map(beforePlacements.map((item) => [item.key, item]));
  const afterByKey = new Map(afterPlacements.map((item) => [item.key, item]));
  const keys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);
  const changes: PlanRevisionChange[] = [];

  for (const key of keys) {
    const before = beforeByKey.get(key);
    const after = afterByKey.get(key);
    if (samePlacement(before, after)) continue;
    changes.push({
      key,
      taskId: after?.taskId ?? before?.taskId ?? key,
      title: after?.title ?? before?.title ?? 'タスク',
      materialId: after?.materialId ?? before?.materialId ?? null,
      kind: changeKind(before, after),
      before,
      after,
    });
  }

  const materialMap = new Map<string, PlanRevisionMaterialChange>();
  for (const change of changes) {
    if (!change.materialId) continue;
    const current = materialMap.get(change.materialId) ?? {
      materialId: change.materialId,
      changedTasks: 0,
      movedTasks: 0,
      beforeMinutes: 0,
      afterMinutes: 0,
    };
    current.changedTasks += 1;
    if (change.kind === 'moved') current.movedTasks += 1;
    current.beforeMinutes += change.before?.estimatedMinutes ?? 0;
    current.afterMinutes += change.after?.estimatedMinutes ?? 0;
    materialMap.set(change.materialId, current);
  }

  return {
    id: `plan-revision:${input.generationId}:${input.createdAt}`,
    generationId: input.generationId,
    createdAt: input.createdAt,
    reason: input.reason,
    fromDate: input.fromDate,
    placements: afterPlacements,
    changes,
    materialChanges: [...materialMap.values()].sort((left, right) => left.materialId.localeCompare(right.materialId)),
  };
}

export function appendPlanRevision(state: AppState, revision: PlanRevision, now = new Date(revision.createdAt)): AppState {
  const settings = state.settings as SettingsWithHistory;
  const historyData = settings.historyData ?? { planRevisions: [], monthlySummaries: [] };
  return {
    ...state,
    settings: {
      ...state.settings,
      historyData: {
        ...historyData,
        planRevisions: compactPlanRevisions([...historyData.planRevisions, revision], now),
      },
    } as SettingsWithHistory,
  };
}

export function restorePlanRevisionLayout(state: AppState, revisionId: string): { state: AppState; restoredTaskCount: number } {
  const settings = state.settings as SettingsWithHistory;
  const revision = (settings.historyData?.planRevisions ?? []).find((item) => item.id === revisionId);
  if (!revision) return { state, restoredTaskCount: 0 };
  const byKey = new Map<string, PlanRevisionTaskPlacement>(revision.placements.map((item) => [item.key, item]));
  let restoredTaskCount = 0;
  const restoredAt = new Date().toISOString();
  const tasks = state.tasks.map((task) => {
    if (task.status === 'done' || task.status === 'skipped' || task.status === 'doing') return task;
    const saved = byKey.get(taskStableKey(task));
    if (!saved) return task;
    const changed = task.scheduledDate !== saved.scheduledDate
      || task.scheduledStart !== saved.scheduledStart
      || task.scheduledEnd !== saved.scheduledEnd
      || task.placementStatus !== saved.placementStatus
      || task.placementLock !== saved.placementLock
      || task.manualOrder !== saved.manualOrder;
    if (!changed) return task;
    restoredTaskCount += 1;
    return {
      ...task,
      scheduledDate: saved.scheduledDate,
      scheduledStart: saved.scheduledStart,
      scheduledEnd: saved.scheduledEnd,
      placementStatus: saved.placementStatus,
      placementLock: saved.placementLock,
      manualOrder: saved.manualOrder,
      updatedAt: restoredAt,
    };
  });
  if (restoredTaskCount === 0) return { state, restoredTaskCount };
  return {
    state: {
      ...state,
      tasks,
      lastPlanReason: `計画履歴「${revision.reason}」の配置を復元`,
      lastReschedule: null,
      lastScheduleResult: null,
    },
    restoredTaskCount,
  };
}
