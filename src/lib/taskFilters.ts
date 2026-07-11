import type { StudyTask, UnitRange } from '../types';

/** 現行計画や集計に含めてよい、実際に配置されたタスクだけを返す。 */
export function isPlacedPlanTask(task: StudyTask): boolean {
  return (task.status === 'planned' || task.status === 'doing' || task.status === 'done')
    && task.placementStatus !== 'conflict'
    && task.placementStatus !== 'unscheduled';
}

/** 日別の手動表示順。同順位なら実時刻と優先度で決定的に並べる。 */
export function compareTaskDisplayOrder(a: StudyTask, b: StudyTask): number {
  const manual = (a.manualOrder ?? Number.POSITIVE_INFINITY) - (b.manualOrder ?? Number.POSITIVE_INFINITY);
  if (manual !== 0) return manual;
  return (a.scheduledStart ?? '99:99').localeCompare(b.scheduledStart ?? '99:99')
    || b.priority - a.priority
    || a.id.localeCompare(b.id);
}

/** 教材タスクの範囲を和集合化し、古い重複タスクで目標量が膨らむのを防ぐ。 */
export function plannedMaterialAmountThrough(
  tasks: StudyTask[],
  materialId: string,
  totalAmount: number,
  date: string,
  baselineRanges: UnitRange[] = [],
): number {
  const relevant = tasks.filter((task) =>
    task.materialId === materialId
    && task.type === 'new'
    && task.scheduledDate <= date
    && task.amount > 0
    && isPlacedPlanTask(task));
  const ranges = [...baselineRanges, ...relevant.flatMap((task) => {
    const range = task.materialRange
      ?? (task.rangeStart !== null && task.rangeEnd !== null ? { start: task.rangeStart, end: task.rangeEnd } : undefined);
    if (!range) return [];
    const start = Math.max(1, Math.min(totalAmount, Math.floor(range.start)));
    const end = Math.max(1, Math.min(totalAmount, Math.floor(range.end)));
    return start <= end ? [{ start, end }] : [];
  })].flatMap((range) => {
    const start = Math.max(1, Math.min(totalAmount, Math.floor(range.start)));
    const end = Math.max(1, Math.min(totalAmount, Math.floor(range.end)));
    return start <= end ? [{ start, end }] : [];
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  let rangedAmount = 0;
  let current: { start: number; end: number } | null = null;
  for (const range of ranges) {
    if (!current) current = { ...range };
    else if (range.start <= current.end + 1) current.end = Math.max(current.end, range.end);
    else {
      rangedAmount += current.end - current.start + 1;
      current = { ...range };
    }
  }
  if (current) rangedAmount += current.end - current.start + 1;
  const unRangedAmount = relevant.reduce((sum, task) => {
    const hasRange = !!task.materialRange || (task.rangeStart !== null && task.rangeEnd !== null);
    return sum + (hasRange ? 0 : task.amount);
  }, 0);
  return Math.min(totalAmount, rangedAmount + unRangedAmount);
}
