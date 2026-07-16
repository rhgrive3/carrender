import { normalizeUnitRanges, remainingUnitRanges, sumRangeLengths } from './scheduler';
import type { AppState, StudySession, StudyTask, UnitRange } from '../types';

function subtractRanges(ranges: UnitRange[], removals: UnitRange[]): UnitRange[] {
  let current = ranges.map((range) => ({ ...range }));
  for (const removal of removals) {
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

function intersectRanges(ranges: UnitRange[], limit: UnitRange): UnitRange[] {
  return ranges.flatMap((range) => {
    const start = Math.max(range.start, limit.start);
    const end = Math.min(range.end, limit.end);
    return start <= end ? [{ start, end }] : [];
  });
}

function taskRange(task?: StudyTask): UnitRange | undefined {
  if (!task) return undefined;
  return task.materialRange
    ?? (task.rangeStart !== null && task.rangeStart !== undefined && task.rangeEnd !== null && task.rangeEnd !== undefined
      ? { start: task.rangeStart, end: task.rangeEnd }
      : undefined);
}

/**
 * 記録編集では、現在の残量だけでなく編集中セッションが追加した範囲も一度だけ
 * 利用可能量へ戻す。保存時のUPDATE_SESSIONが行う差し戻しと同じ前提に揃えることで、
 * 既存記録を増やせない・タスク範囲外まで入力できる、といった表示上限のずれを防ぐ。
 */
export function recordAmountInputLimit(
  state: AppState,
  materialId: string,
  session?: StudySession,
  task?: StudyTask,
): number {
  const material = state.materials.find((item) => item.id === materialId);
  if (!material) return Math.max(0, task?.amount ?? session?.amountDone ?? 9999);

  const total = material.totalAmount;
  const completed = normalizeUnitRanges(
    material.completedRanges ?? (material.doneAmount > 0 ? [{ start: 1, end: material.doneAmount }] : []),
    total,
  );
  const ownContribution = session?.materialId === material.id
    ? normalizeUnitRanges(session.progressRangesAdded ?? [], total)
    : [];
  const completedWithoutEditedSession = ownContribution.length > 0
    ? subtractRanges(completed, ownContribution)
    : completed;

  let eligible = remainingUnitRanges(total, completedWithoutEditedSession);
  const explicit = taskRange(task);
  if (explicit) eligible = intersectRanges(eligible, explicit);

  let limit = sumRangeLengths(eligible);
  if (task && !explicit) limit = Math.min(limit, Math.max(0, task.amount));

  // 旧形式記録には寄与範囲がない。保存前から値を入力不能にしないため、既存値は維持する。
  if (session?.materialId === material.id && ownContribution.length === 0) {
    limit = Math.max(limit, session.amountDone);
  }
  return Math.max(0, limit);
}
