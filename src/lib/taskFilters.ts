import type { Material, PlanHistoryEntry, StudySession, StudyTask, UnitRange } from '../types';

/** 現行計画や集計に含めてよい、実際に配置されたタスクだけを返す。 */
export function isPlacedPlanTask(task: StudyTask): boolean {
  return (task.status === 'planned' || task.status === 'doing' || task.status === 'done')
    && task.placementStatus !== 'conflict'
    && task.placementStatus !== 'unscheduled';
}

/** 日別の手動表示順。同順位なら実時刻と優先度で決定的に並べる。 */
export function compareTaskDisplayOrder(a: StudyTask, b: StudyTask): number {
  if (a.manualOrder !== undefined || b.manualOrder !== undefined) {
    if (a.manualOrder === undefined) return 1;
    if (b.manualOrder === undefined) return -1;
    if (a.manualOrder !== b.manualOrder) return a.manualOrder - b.manualOrder;
  }
  return (a.scheduledStart ?? '99:99').localeCompare(b.scheduledStart ?? '99:99')
    || b.priority - a.priority
    || a.id.localeCompare(b.id);
}

function boundedRange(range: UnitRange, totalAmount: number): UnitRange | null {
  const start = Math.max(1, Math.min(totalAmount, Math.floor(range.start)));
  const end = Math.max(1, Math.min(totalAmount, Math.floor(range.end)));
  return start <= end ? { start, end } : null;
}

function mergeUnitRanges(ranges: UnitRange[], totalAmount = Number.MAX_SAFE_INTEGER): UnitRange[] {
  const normalized = ranges
    .map((range) => boundedRange(range, totalAmount))
    .filter((range): range is UnitRange => range !== null)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: UnitRange[] = [];
  for (const range of normalized) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function unitRangeAmount(ranges: UnitRange[]): number {
  return ranges.reduce((sum, range) => sum + range.end - range.start + 1, 0);
}

function intersectUnitRanges(left: UnitRange[], right: UnitRange[]): UnitRange[] {
  const intersections: UnitRange[] = [];
  for (const a of left) {
    for (const b of right) {
      const start = Math.max(a.start, b.start);
      const end = Math.min(a.end, b.end);
      if (start <= end) intersections.push({ start, end });
    }
  }
  return mergeUnitRanges(intersections);
}

function subtractUnitRanges(base: UnitRange[], removals: UnitRange[]): UnitRange[] {
  let result = mergeUnitRanges(base);
  for (const removal of mergeUnitRanges(removals)) {
    result = result.flatMap((range) => {
      if (removal.end < range.start || removal.start > range.end) return [range];
      return [
        ...(removal.start > range.start ? [{ start: range.start, end: removal.start - 1 }] : []),
        ...(removal.end < range.end ? [{ start: removal.end + 1, end: range.end }] : []),
      ];
    });
  }
  return mergeUnitRanges(result);
}

/**
 * 現在の完了範囲のうち、日付へ正確に帰属できない旧記録分。
 * v4以前のセッションは推測せず、チャート開始時点の基準進捗として扱う。
 */
export function legacyProgressBaselineRanges(material: Material, sessions: StudySession[]): UnitRange[] {
  const completed = mergeUnitRanges(
    material.completedRanges
      ?? (material.doneAmount > 0 ? [{ start: 1, end: material.doneAmount }] : []),
    material.totalAmount,
  );
  const exact = mergeUnitRanges(
    sessions
      .filter((session) => session.materialId === material.id)
      .flatMap((session) => session.progressRangesAdded ?? []),
    material.totalAmount,
  );
  return subtractUnitRanges(completed, intersectUnitRanges(exact, completed));
}

/** 正確な進捗範囲だけを和集合化し、重複セッションで実績を水増ししない。 */
export function actualMaterialAmountThrough(
  material: Material,
  sessions: StudySession[],
  date: string,
): number {
  const completed = mergeUnitRanges(
    material.completedRanges
      ?? (material.doneAmount > 0 ? [{ start: 1, end: material.doneAmount }] : []),
    material.totalAmount,
  );
  const baseline = legacyProgressBaselineRanges(material, sessions);
  const exactThroughDate = mergeUnitRanges(
    sessions
      .filter((session) => session.materialId === material.id && session.date <= date)
      .flatMap((session) => session.progressRangesAdded ?? []),
    material.totalAmount,
  );
  return Math.min(
    material.totalAmount,
    unitRangeAmount(mergeUnitRanges([...baseline, ...intersectUnitRanges(exactThroughDate, completed)], material.totalAmount)),
  );
}

/** 教材タスクの範囲を和集合化し、古い重複タスクで目標量が膨らむのを防ぐ。 */
export function plannedMaterialAmountThrough(
  tasks: StudyTask[],
  materialId: string,
  totalAmount: number,
  date: string,
  baselineRanges: UnitRange[] = [],
  planHistory: PlanHistoryEntry[] = [],
): number {
  const relevant = tasks.filter((task) =>
    task.materialId === materialId
    && task.type === 'new'
    && task.scheduledDate <= date
    && task.amount > 0
    && isPlacedPlanTask(task));
  const historical = planHistory.filter((entry) =>
    entry.materialId === materialId
    && entry.type === 'new'
    && entry.scheduledDate <= date
    && entry.amount > 0);
  const ranges = mergeUnitRanges([
    ...baselineRanges,
    ...relevant.flatMap((task) => {
      const range = task.materialRange
        ?? (task.rangeStart !== null && task.rangeEnd !== null ? { start: task.rangeStart, end: task.rangeEnd } : undefined);
      return range ? [range] : [];
    }),
    ...historical.flatMap((entry) => {
      const range = entry.materialRange
        ?? (entry.rangeStart !== null && entry.rangeEnd !== null ? { start: entry.rangeStart, end: entry.rangeEnd } : undefined);
      return range ? [range] : [];
    }),
  ], totalAmount);
  const relevantIds = new Set(relevant.map((task) => task.id));
  const unRangedAmount = relevant.reduce((sum, task) => {
    const hasRange = !!task.materialRange || (task.rangeStart !== null && task.rangeEnd !== null);
    return sum + (hasRange ? 0 : task.amount);
  }, 0) + historical.reduce((sum, entry) => {
    const hasRange = !!entry.materialRange || (entry.rangeStart !== null && entry.rangeEnd !== null);
    // 同じ手動タスクを未来へ再配置した場合、過去の未達成予定と現在予定を
    // 二重に目標量へ足さない。日付前なら履歴、再配置日以降は現行タスクが代表する。
    return sum + (hasRange || relevantIds.has(entry.taskId) ? 0 : entry.amount);
  }, 0);
  return Math.min(totalAmount, unitRangeAmount(ranges) + unRangedAmount);
}
