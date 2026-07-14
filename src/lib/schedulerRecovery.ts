import type { AppState, ISODate, Material, ScheduleGenerationResult, SchedulerContext } from '../types';
import { addDays, diffDays } from './date';
import { dateInTimeZone, generatePlanV2 as generateBasePlanV2 } from './schedulerV2';

function recoveryEnd(state: AppState, today: ISODate): ISODate {
  const configuredEnd = addDays(today, Math.max(1, state.settings.taskGenerationHorizonDays ?? 42) - 1);
  return state.goal?.examDate && state.goal.examDate > configuredEnd ? state.goal.examDate : configuredEnd;
}

/**
 * 期限切れを「候補日なし」として捨てず、ローリング計画期間へ回収してから
 * 既存ソルバーへ渡す。元の期限はタスク表示・期限レポートへ戻す。
 */
export function generatePlanV2(state: AppState, context: SchedulerContext): ScheduleGenerationResult {
  const today = dateInTimeZone(context.now, context.timezone);
  const end = recoveryEnd(state, today);
  const overdue = new Map<string, Material>();
  for (const material of state.materials) {
    if (!material.paused && !material.archived && material.doneAmount < material.totalAmount && material.targetDate < today) {
      overdue.set(material.id, material);
    }
  }
  if (overdue.size === 0) return generateBasePlanV2(state, context);

  const adjustedState: AppState = {
    ...state,
    materials: state.materials.map((material) => overdue.has(material.id)
      ? { ...material, targetDate: end, preferredFinishDate: undefined }
      : material),
  };
  const result = generateBasePlanV2(adjustedState, context);
  const warnings = [...overdue.values()].map((material) => ({
    code: 'OVERDUE_RECOVERY',
    targetId: material.id,
    message: `${material.name}は期限を${diffDays(material.targetDate, today)}日超過しています。未完了分を${today}〜${end}へ回復計画として再配置しました`,
  }));

  return {
    ...result,
    scheduledTasks: result.scheduledTasks.map((task) => {
      const material = task.materialId ? overdue.get(task.materialId) : undefined;
      return material ? { ...task, dueDate: material.targetDate } : task;
    }),
    deadlineReports: result.deadlineReports.map((report) => {
      const materialId = report.workItemId.startsWith('material:') ? report.workItemId.slice('material:'.length) : null;
      const material = materialId ? overdue.get(materialId) : undefined;
      return material
        ? { ...report, deadline: material.targetDate, overdueDays: diffDays(material.targetDate, today) }
        : report;
    }),
    warnings: [...warnings, ...result.warnings],
  };
}
