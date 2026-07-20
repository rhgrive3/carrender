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

export interface CompletedTaskHistoryRepair {
  sessionId: string;
  taskId: string;
  taskTitle: string;
  previousStatus: StudyTask['status'];
  scheduledDate: string;
}

export interface CompletedTaskHistoryIntegrityResult {
  state: AppState;
  repairs: CompletedTaskHistoryRepair[];
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
  const sourceType = task.sourceType ?? (task.generatedBy === 'manual' ? 'manual' : 'material');
  return sourceType === 'material';
}

/**
 * 完了記録は残っているのに、対応タスクがplannedへ戻った旧データを修復する。
 * taskSnapshotBeforeは完了操作直前の不変履歴なので、そこから当時の日付・範囲を復元し、
 * 今日のチェック表示と達成率を守る。
 *
 * タスク自体が存在しない場合は、明示削除と旧不具合による消失を判別できない。
 * 使用者の削除操作を起動時修復で取り消さないため、欠損タスクは復元しない。
 */
export function reconcileCompletedTaskHistory(state: AppState): CompletedTaskHistoryIntegrityResult {
  const repairs: CompletedTaskHistoryRepair[] = [];
  const tasks = [...state.tasks];
  const indexById = new Map(tasks.map((task, index) => [task.id, index]));

  const completedSessions = state.sessions
    .filter((session) => session.completedTask && session.taskId && session.taskSnapshotBefore)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id));

  for (const session of completedSessions) {
    const taskId = session.taskId!;
    const snapshot = session.taskSnapshotBefore!;
    const currentIndex = indexById.get(taskId);
    if (currentIndex === undefined) continue;
    const current = tasks[currentIndex];
    if (current.status === 'done') continue;

    const restored: StudyTask = {
      ...snapshot,
      id: taskId,
      status: 'done',
      completedAt: current.completedAt ?? session.updatedAt ?? session.startedAt,
      updatedAt: session.updatedAt ?? session.startedAt,
    };
    tasks[currentIndex] = restored;
    repairs.push({
      sessionId: session.id,
      taskId,
      taskTitle: restored.title,
      previousStatus: current.status,
      scheduledDate: restored.scheduledDate,
    });
  }

  return repairs.length > 0 ? { state: { ...state, tasks }, repairs } : { state, repairs };
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
