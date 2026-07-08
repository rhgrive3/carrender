import type { AppState, ISODate, StudySession, StudyTask } from '../types';
import { addDays, genId } from './date';

/**
 * 忘却曲線ベースの復習タスク生成。
 *
 * - 新規タスク完了 → stage 0 の復習を interval[0] 日後に生成
 * - 復習タスク完了 → 次の stage を生成 (最終stageで終了)
 * - 正答率が低い → 間隔を短縮
 * - 正答率が高い → 間隔を延長
 * - 難易度が高い教材 → stage を1つ追加(30日後をもう一度)
 * - 正答率が閾値未満 → 間違い直しタスクを翌日に生成
 */
export function generateReviewTasks(
  state: AppState,
  completedTask: StudyTask,
  session: StudySession,
  refDate: ISODate,
): StudyTask[] {
  const rule = state.settings.reviewRule;
  const material = state.materials.find((m) => m.id === completedTask.materialId);
  const created: StudyTask[] = [];

  // 対象外: 過去問演習・模試復習は自動連鎖しない
  if (completedTask.type === 'pastExam' || completedTask.type === 'mockReview') return created;

  const nextStage = completedTask.type === 'review' ? (completedTask.reviewStage ?? 0) + 1 : 0;
  // 「復習N回目」「間違い直し」の接頭辞を除いた元の範囲名
  const baseRange = completedTask.rangeLabel.replace(/^(復習\d+回目|間違い直し)\s*/, '');

  let intervals = [...rule.intervals];
  // 難易度が高い教材は復習回数を増やす(最終間隔をもう一度)
  if (material && material.difficulty >= 4 && intervals.length > 0) {
    intervals = [...intervals, intervals[intervals.length - 1]];
  }

  if (nextStage < intervals.length) {
    let interval = intervals[nextStage];
    const acc = session.accuracy;
    if (acc !== null) {
      if (acc < rule.lowAccuracyThreshold) interval = Math.max(1, Math.round(interval * 0.6));
      else if (acc >= rule.highAccuracyThreshold) interval = Math.round(interval * 1.4);
    }
    const due = addDays(refDate, interval);
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

  // 間違い直し: 正答率が低いとき翌日に
  if (session.accuracy !== null && session.accuracy < rule.correctionThreshold && completedTask.type !== 'correction') {
    const due = addDays(refDate, 1);
    created.push({
      id: genId('task'),
      subjectId: completedTask.subjectId,
      materialId: completedTask.materialId,
      title: completedTask.title,
      rangeLabel: `間違い直し ${baseRange}`,
      rangeStart: completedTask.rangeStart,
      rangeEnd: completedTask.rangeEnd,
      amount: completedTask.amount,
      estimatedMinutes: Math.max(20, Math.round(completedTask.estimatedMinutes * 0.5)),
      priority: 0,
      dueDate: due,
      type: 'correction',
      status: 'planned',
      scheduledDate: due,
      scheduledStart: null,
      scheduledEnd: null,
      generatedBy: 'auto',
      reviewStage: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
  }

  return created;
}

/** 期限切れ・期限間近の復習タスク */
export function dueReviews(state: AppState, date: ISODate): { overdue: StudyTask[]; upcoming: StudyTask[] } {
  const reviews = state.tasks.filter(
    (t) => (t.type === 'review' || t.type === 'correction') && t.status === 'planned' && t.dueDate !== null,
  );
  return {
    overdue: reviews.filter((t) => (t.dueDate as string) < date),
    upcoming: reviews.filter((t) => {
      const d = t.dueDate as string;
      return d >= date && d <= addDays(date, 2);
    }),
  };
}
