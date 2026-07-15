import type { AppState, Material, StudyTask, UnitRange } from '../types';

export interface MaterialProgressRepair {
  materialId: string;
  materialName: string;
  previousDoneAmount: number;
  repairedDoneAmount: number;
  recoveredUnits: number;
}

export interface MaterialProgressIntegrityResult {
  state: AppState;
  repairs: MaterialProgressRepair[];
}

function normalizeRanges(ranges: UnitRange[], total: number): UnitRange[] {
  const sorted = ranges
    .filter((range) => Number.isInteger(range.start)
      && Number.isInteger(range.end)
      && range.start >= 1
      && range.start <= range.end
      && range.end <= total)
    .map((range) => ({ start: range.start, end: range.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: UnitRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end);
    else merged.push(range);
  }
  return merged;
}

function rangeLength(ranges: UnitRange[]): number {
  return ranges.reduce((sum, range) => sum + range.end - range.start + 1, 0);
}

function taskRange(task: StudyTask, total: number): UnitRange | null {
  const range = task.materialRange
    ?? (Number.isFinite(task.rangeStart) && Number.isFinite(task.rangeEnd)
      ? { start: task.rangeStart!, end: task.rangeEnd! }
      : null);
  if (!range
    || !Number.isInteger(range.start)
    || !Number.isInteger(range.end)
    || range.start < 1
    || range.start > range.end
    || range.end > total) return null;
  return { start: range.start, end: range.end };
}

function isCompletedMaterialWork(task: StudyTask, material: Material): boolean {
  if (task.status !== 'done' || task.type !== 'new' || task.materialId !== material.id) return false;
  const sourceType = task.sourceType
    ?? (task.generatedBy === 'manual' ? 'manual' : task.type === 'review' ? 'review' : 'material');
  return sourceType === 'material';
}

/**
 * 古い記録では「タスクを完了」にしても、入力した進捗量だけが教材へ加算され、
 * タスク範囲の末尾が未完了のまま残ることがあった。完了済みの新規教材タスクは
 * 現行仕様では範囲全体の完了を意味するため、その範囲を教材進捗へ復元する。
 * 復習・手動タスクは教材の新規進捗として扱わない。
 */
export function reconcileCompletedMaterialProgress(state: AppState): MaterialProgressIntegrityResult {
  const repairs: MaterialProgressRepair[] = [];
  const materials = state.materials.map((material) => {
    const total = Math.max(0, Math.floor(material.totalUnits ?? material.totalAmount));
    if (total <= 0) return material;
    const current = normalizeRanges(
      material.completedRanges
        ?? (material.doneAmount > 0 ? [{ start: 1, end: Math.min(total, material.doneAmount) }] : []),
      total,
    );
    const completedTaskRanges = state.tasks
      .filter((task) => isCompletedMaterialWork(task, material))
      .map((task) => taskRange(task, total))
      .filter((range): range is UnitRange => range !== null);
    if (completedTaskRanges.length === 0) return material;

    const merged = normalizeRanges([...current, ...completedTaskRanges], total);
    const previousDoneAmount = rangeLength(current);
    const repairedDoneAmount = rangeLength(merged);
    if (repairedDoneAmount <= previousDoneAmount) return material;

    repairs.push({
      materialId: material.id,
      materialName: material.name,
      previousDoneAmount,
      repairedDoneAmount,
      recoveredUnits: repairedDoneAmount - previousDoneAmount,
    });
    return {
      ...material,
      totalUnits: total,
      completedRanges: merged,
      doneAmount: repairedDoneAmount,
    };
  });

  return repairs.length > 0 ? { state: { ...state, materials }, repairs } : { state, repairs };
}
