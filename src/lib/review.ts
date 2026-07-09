import type { AppState, ISODate, StudyTask } from '../types';
import { addDays, genId } from './date';

/**
 * 忘却曲線ベースの復習タスク生成。
 *
 * - 新規タスク完了 → stage 0 の復習を interval[0] 日後に生成
 * - 復習タスク完了 → 次の stage を生成 (最終stageで終了)
 * 教材で復習を明示的に有効化した場合だけ生成する。
 *
 * - 難易度が高い教材 → stage を1つ追加(30日後をもう一度)
 */
export function generateReviewTasks(
  state: AppState,
  completedTask: StudyTask,
  refDate: ISODate,
): StudyTask[] {
  const rule = state.settings.reviewRule;
  const material = state.materials.find((m) => m.id === completedTask.materialId);
  const created: StudyTask[] = [];

  // 自動生成そのものがオフなら何も作らない
  if (!rule.enabled) return created;
  // 対象外: 過去問演習・模試復習は自動連鎖しない
  if (completedTask.type === 'pastExam' || completedTask.type === 'mockReview') return created;
  if (!material?.reviewEnabled) return created;

  const nextStage = completedTask.type === 'review' ? (completedTask.reviewStage ?? 0) + 1 : 0;
  // 「復習N回目」の接頭辞を除いた元の範囲名
  const baseRange = completedTask.rangeLabel.replace(/^復習\d+回目\s*/, '');

  let intervals = material?.reviewIntervals?.length ? [...material.reviewIntervals] : [...rule.intervals];
  // 難易度が高い教材は復習回数を増やす(最終間隔をもう一度)
  if (material && material.difficulty >= 4 && intervals.length > 0) {
    intervals = [...intervals, intervals[intervals.length - 1]];
  }

  if (nextStage < intervals.length) {
    const due = addDays(refDate, intervals[nextStage]);
    const estimated = Math.max(15, Math.round(completedTask.estimatedMinutes * 0.4));
    created.push({
      id: genId('task'),
      subjectId: completedTask.subjectId,
      materialId: completedTask.materialId,
      title: completedTask.title,
      rangeLabel: `復習${nextStage + 1}回目 ${baseRange}`,
      rangeStart: completedTask.rangeStart,
      rangeEnd: completedTask.rangeEnd,
      amount: completedTask.amount,
      estimatedMinutes: estimated,
      priority: 0,
      dueDate: due,
      type: 'review',
      status: 'planned',
      scheduledDate: due,
      scheduledStart: null,
      scheduledEnd: null,
      generatedBy: 'auto',
      reviewStage: nextStage,
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
  }

  return created;
}
