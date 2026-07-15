import type {
  AppState,
  ScheduleGenerationResult,
  SchedulerContext,
  StudyTask,
} from '../types';
import {
  smoothMaterialSchedule,
  summarizeMaterialConcentration,
  type MaterialConcentrationSummary,
} from './materialScheduleSmoothing';

export type MaterialScheduleSmoother = (
  state: AppState,
  result: ScheduleGenerationResult,
  context: SchedulerContext,
) => ScheduleGenerationResult;

interface GlobalConcentrationSummary {
  totalSameDayExcess: number;
  worstMaxDayMinutes: number;
  sumMaxDayMinutes: number;
  totalActiveDays: number;
}

const MAX_RETRY_ROUNDS = 4;

function isMovableMaterialTask(task: StudyTask): boolean {
  return task.status === 'planned'
    && task.sourceType === 'material'
    && task.generatedBy === 'auto'
    && task.type === 'new'
    && task.materialId !== null
    && (task.placementLock ?? 'none') === 'none';
}

/**
 * 他教材を改善するための交換で、もともと分散していた教材を大きく集中させない。
 * 5%または15分までの最大日負荷増加、実施日1日減までは詰合せ誤差として許容する。
 */
export function isMaterialConcentrationRegressionAcceptable(
  before: MaterialConcentrationSummary,
  after: MaterialConcentrationSummary,
): boolean {
  const allowedMinutesIncrease = Math.max(15, Math.round(before.maxDayMinutes * 0.05));
  if (after.maxDayMinutes > before.maxDayMinutes + allowedMinutesIncrease) return false;
  if (after.activeDays < before.activeDays - 1) return false;
  // 集中が無かった教材へ新しい同日重複を作らない。既に集中がある教材も+1まで。
  const allowedExtra = before.sameDayExcess === 0 ? 0 : 1;
  return after.sameDayExcess <= before.sameDayExcess + allowedExtra;
}

function summaryByMaterial(
  state: AppState,
  result: ScheduleGenerationResult,
): Map<string, MaterialConcentrationSummary> {
  return new Map(state.materials.map((material) => [
    material.id,
    summarizeMaterialConcentration(result.scheduledTasks, material.id),
  ]));
}

function severeRegressions(
  before: ReadonlyMap<string, MaterialConcentrationSummary>,
  after: ReadonlyMap<string, MaterialConcentrationSummary>,
): string[] {
  return [...before.keys()]
    .filter((materialId) => !isMaterialConcentrationRegressionAcceptable(
      before.get(materialId)!,
      after.get(materialId)!,
    ))
    .sort();
}

function globalSummary(summaries: ReadonlyMap<string, MaterialConcentrationSummary>): GlobalConcentrationSummary {
  const values = [...summaries.values()];
  return {
    totalSameDayExcess: values.reduce((sum, value) => sum + value.sameDayExcess, 0),
    worstMaxDayMinutes: Math.max(0, ...values.map((value) => value.maxDayMinutes)),
    sumMaxDayMinutes: values.reduce((sum, value) => sum + value.maxDayMinutes, 0),
    totalActiveDays: values.reduce((sum, value) => sum + value.activeDays, 0),
  };
}

function isGloballyBetter(
  before: ReadonlyMap<string, MaterialConcentrationSummary>,
  after: ReadonlyMap<string, MaterialConcentrationSummary>,
): boolean {
  const left = globalSummary(after);
  const right = globalSummary(before);
  const comparisons = [
    left.totalSameDayExcess - right.totalSameDayExcess,
    left.worstMaxDayMinutes - right.worstMaxDayMinutes,
    left.sumMaxDayMinutes - right.sumMaxDayMinutes,
    right.totalActiveDays - left.totalActiveDays,
  ];
  for (const difference of comparisons) {
    if (difference !== 0) return difference < 0;
  }
  return false;
}

function withFrozenMaterials(
  result: ScheduleGenerationResult,
  frozenMaterialIds: ReadonlySet<string>,
): ScheduleGenerationResult {
  if (frozenMaterialIds.size === 0) return result;
  return {
    ...result,
    scheduledTasks: result.scheduledTasks.map((task) =>
      task.materialId && frozenMaterialIds.has(task.materialId) && isMovableMaterialTask(task)
        ? { ...task, placementLock: 'date' }
        : task),
  };
}

function restorePlacementLocks(
  result: ScheduleGenerationResult,
  originalLocks: ReadonlyMap<string, StudyTask['placementLock']>,
): ScheduleGenerationResult {
  return {
    ...result,
    scheduledTasks: result.scheduledTasks.map((task) => originalLocks.has(task.id)
      ? { ...task, placementLock: originalLocks.get(task.id) }
      : task),
  };
}

/**
 * 平準化で別教材が大きく悪化した場合、その教材を元日付へ凍結して再探索する。
 * 安全な改善解が見つからなければ、既存ソルバーの元計画へ完全フォールバックする。
 */
export function smoothMaterialScheduleSafely(
  state: AppState,
  result: ScheduleGenerationResult,
  context: SchedulerContext,
  smoother: MaterialScheduleSmoother = smoothMaterialSchedule,
): ScheduleGenerationResult {
  const baselineSummaries = summaryByMaterial(state, result);
  const originalLocks = new Map(result.scheduledTasks.map((task) => [task.id, task.placementLock] as const));
  const frozenMaterialIds = new Set<string>();

  for (let round = 0; round < MAX_RETRY_ROUNDS; round += 1) {
    const working = withFrozenMaterials(result, frozenMaterialIds);
    const candidate = restorePlacementLocks(smoother(state, working, context), originalLocks);
    const candidateSummaries = summaryByMaterial(state, candidate);
    const regressions = severeRegressions(baselineSummaries, candidateSummaries);
    if (regressions.length === 0) {
      return isGloballyBetter(baselineSummaries, candidateSummaries) ? candidate : result;
    }
    const beforeSize = frozenMaterialIds.size;
    for (const materialId of regressions) frozenMaterialIds.add(materialId);
    if (frozenMaterialIds.size === beforeSize) break;
  }
  return result;
}
