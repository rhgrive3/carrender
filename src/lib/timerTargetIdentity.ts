import type { StudySession, StudyTask } from '../types';

export interface TimerTargetRange {
  start: number;
  end: number;
}

export interface TimerTargetLocator {
  taskId: string | null;
  materialId: string | null;
  sourceId?: string;
  range?: TimerTargetRange;
  type?: StudyTask['type'];
}

export interface TimerSessionLocatorInput {
  taskId: string | null;
  materialId: string | null;
  taskLocator?: {
    sourceId?: string;
    range?: TimerTargetRange;
    type?: StudyTask['type'];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function normalizeTimerTargetRange(value: unknown): TimerTargetRange | undefined {
  if (!isRecord(value)) return undefined;
  const { start, end } = value;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return undefined;
  if ((start as number) < 0 || (end as number) < (start as number)) return undefined;
  return { start: start as number, end: end as number };
}

export function normalizeTimerTargetLocator(value: unknown): TimerTargetLocator | null {
  if (!isRecord(value)) return null;
  const taskId = normalizeOptionalId(value.taskId);
  const materialId = normalizeOptionalId(value.materialId);
  if (taskId === undefined || materialId === undefined) return null;
  const sourceId = normalizeOptionalId(value.sourceId);
  if (sourceId === null) return null;
  const range = value.range === undefined ? undefined : normalizeTimerTargetRange(value.range);
  if (value.range !== undefined && !range) return null;
  const type = value.type;
  if (type !== undefined && !['new', 'review', 'mockReview', 'pastExam'].includes(String(type))) return null;
  return {
    taskId,
    materialId,
    ...(sourceId ? { sourceId } : {}),
    ...(range ? { range } : {}),
    ...(type ? { type: type as StudyTask['type'] } : {}),
  };
}

export function parsePersistedTimerTarget(value: unknown, owner: string | null): TimerTargetLocator | null {
  if (!owner || !isRecord(value) || value.owner !== owner) return null;
  return normalizeTimerTargetLocator(value.target);
}

export function timerTargetRangeFromTask(task: StudyTask): TimerTargetRange | undefined {
  return task.materialRange
    ?? (Number.isFinite(task.rangeStart) && Number.isFinite(task.rangeEnd)
      ? normalizeTimerTargetRange({ start: task.rangeStart, end: task.rangeEnd })
      : undefined);
}

export function timerTargetLocatorFromTask(task: StudyTask): TimerTargetLocator {
  const range = timerTargetRangeFromTask(task);
  return {
    taskId: task.id,
    materialId: task.materialId,
    ...(task.sourceId ? { sourceId: task.sourceId } : {}),
    ...(range ? { range } : {}),
    ...(task.type ? { type: task.type } : {}),
  };
}

export function timerTargetLocatorFromSessionInput(input: TimerSessionLocatorInput): TimerTargetLocator {
  return {
    taskId: input.taskId,
    materialId: input.materialId,
    ...(input.taskLocator?.sourceId ? { sourceId: input.taskLocator.sourceId } : {}),
    ...(input.taskLocator?.range ? { range: input.taskLocator.range } : {}),
    ...(input.taskLocator?.type ? { type: input.taskLocator.type } : {}),
  };
}

function sameRange(left?: TimerTargetRange, right?: TimerTargetRange): boolean {
  if (!left || !right) return !left && !right;
  return left.start === right.start && left.end === right.end;
}

/** 同じ表示用task ID、または再計画後も安定するsource/material/type/rangeで同じ作業を判定する。 */
export function timerTargetsSameWork(left: TimerTargetLocator, right: TimerTargetLocator): boolean {
  if (left.taskId && right.taskId && left.taskId === right.taskId) return true;
  if (!left.sourceId || !right.sourceId || left.sourceId !== right.sourceId) return false;
  if (left.materialId !== right.materialId) return false;
  if (left.type && right.type && left.type !== right.type) return false;
  return sameRange(left.range, right.range);
}

export function timerTargetMatchesTask(target: TimerTargetLocator, task: StudyTask): boolean {
  return timerTargetsSameWork(target, timerTargetLocatorFromTask(task));
}

export function timerTargetMatchesSessionInput(
  target: TimerTargetLocator,
  input: TimerSessionLocatorInput,
): boolean {
  return timerTargetsSameWork(target, timerTargetLocatorFromSessionInput(input));
}

export function timerTargetMatchesSession(target: TimerTargetLocator, session: StudySession): boolean {
  if (target.taskId && session.taskId === target.taskId) return true;
  return Boolean(session.taskSnapshotBefore && timerTargetMatchesTask(target, session.taskSnapshotBefore));
}
