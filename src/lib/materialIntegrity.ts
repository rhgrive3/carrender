import type { Material, ScheduleGenerationResult, SchedulerContext, ValidationIssue } from '../types';
import { toISODate } from './date';

export interface MaterialIntegrityIssue {
  field: string;
  value: unknown;
  reason: string;
  suggestion: string;
}

function issue(field: string, value: unknown, reason: string, suggestion: string): MaterialIntegrityIssue {
  return { field, value, reason, suggestion };
}

function isSafeIntegerAtLeast(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function completedRangeAmount(material: Material, total: number, issues: MaterialIntegrityIssue[]): number | null {
  if (material.completedRanges === undefined) return material.doneAmount;
  if (!Array.isArray(material.completedRanges)) {
    issues.push(issue('completedRanges', material.completedRanges, '完了範囲の形式が正しくありません', '整数の開始・終了範囲を指定してください'));
    return null;
  }
  const ranges = [...material.completedRanges].sort((left, right) => left.start - right.start || left.end - right.end);
  let amount = 0;
  let previousEnd = 0;
  for (const [index, range] of ranges.entries()) {
    if (!isSafeIntegerAtLeast(range?.start, 1)
      || !isSafeIntegerAtLeast(range?.end, 1)
      || range.start > range.end
      || range.end > total) {
      issues.push(issue(`completedRanges.${index}`, range, '完了範囲が教材総量外または整数範囲ではありません', `1〜${total}の整数範囲を指定してください`));
      return null;
    }
    const uncoveredStart = Math.max(range.start, previousEnd + 1);
    if (uncoveredStart <= range.end) amount += range.end - uncoveredStart + 1;
    previousEnd = Math.max(previousEnd, range.end);
  }
  return amount;
}

export function validateMaterialIntegrity(material: Material): MaterialIntegrityIssue[] {
  const issues: MaterialIntegrityIssue[] = [];

  if (!isSafeIntegerAtLeast(material.totalAmount, 1)) {
    issues.push(issue('totalAmount', material.totalAmount, '教材の総量は1以上の整数にしてください', '小数・NaN・Infinityは使用できません'));
  }
  if (material.totalUnits !== undefined && !isSafeIntegerAtLeast(material.totalUnits, 1)) {
    issues.push(issue('totalUnits', material.totalUnits, '教材総量の互換値は1以上の整数にしてください', 'totalAmountと同じ整数を指定してください'));
  }
  if (isSafeIntegerAtLeast(material.totalAmount, 1)
    && material.totalUnits !== undefined
    && material.totalUnits !== material.totalAmount) {
    issues.push(issue('totalUnits', material.totalUnits, 'totalUnitsとtotalAmountが一致していません', `${material.totalAmount}に揃えてください`));
  }
  if (!isSafeIntegerAtLeast(material.doneAmount, 0)
    || (isSafeIntegerAtLeast(material.totalAmount, 1) && material.doneAmount > material.totalAmount)) {
    issues.push(issue('doneAmount', material.doneAmount, '終わった量は0以上、教材総量以下の整数にしてください', '小数・NaN・Infinityは使用できません'));
  }

  const total = isSafeIntegerAtLeast(material.totalAmount, 1) ? material.totalAmount : null;
  if (total !== null) {
    const rangeAmount = completedRangeAmount(material, total, issues);
    if (rangeAmount !== null && isSafeIntegerAtLeast(material.doneAmount, 0) && rangeAmount !== material.doneAmount) {
      issues.push(issue('completedRanges', material.completedRanges, '完了範囲の合計と終わった量が一致していません', `完了範囲の合計を${material.doneAmount}に揃えてください`));
    }
  }

  if (!isFinitePositive(material.minutesPerUnit)) {
    issues.push(issue('minutesPerUnit', material.minutesPerUnit, '1単位あたりの分数は0より大きい有限値にしてください', 'NaN・Infinityは使用できません'));
  }
  if (material.estimatedMinutesPerUnit !== undefined && !isFinitePositive(material.estimatedMinutesPerUnit)) {
    issues.push(issue('estimatedMinutesPerUnit', material.estimatedMinutesPerUnit, '提案中の見積時間は0より大きい有限値にしてください', '値を削除するか正の数へ修正してください'));
  }

  const integerFields: Array<[keyof Material, unknown, number]> = [
    ['unitStep', material.unitStep ?? 1, 1],
    ['minimumChunkUnits', material.minimumChunkUnits, 1],
    ['maximumChunkUnits', material.maximumChunkUnits, 1],
    ['maxUnitsPerDay', material.maxUnitsPerDay, 1],
    ['round', material.round, 1],
  ];
  for (const [field, value, minimum] of integerFields) {
    if (value !== undefined && !isSafeIntegerAtLeast(value, minimum)) {
      issues.push(issue(String(field), value, `${String(field)}は${minimum}以上の整数にしてください`, '小数・NaN・Infinityは使用できません'));
    }
  }
  if (isSafeIntegerAtLeast(material.minimumChunkUnits ?? 1, 1)
    && material.maximumChunkUnits !== undefined
    && isSafeIntegerAtLeast(material.maximumChunkUnits, 1)
    && material.maximumChunkUnits < (material.minimumChunkUnits ?? 1)) {
    issues.push(issue('maximumChunkUnits', material.maximumChunkUnits, '最大チャンクが最小チャンク未満です', '最小チャンク以上にしてください'));
  }

  if (material.maxMinutesPerDay !== undefined && !isFinitePositive(material.maxMinutesPerDay)) {
    issues.push(issue('maxMinutesPerDay', material.maxMinutesPerDay, '1日の時間上限は0より大きい有限値にしてください', '値を削除するか正の数へ修正してください'));
  }
  for (const [field, value] of [['dailyTarget', material.dailyTarget], ['weeklyTarget', material.weeklyTarget]] as const) {
    if (value !== null && !isFinitePositive(value)) {
      issues.push(issue(field, value, `${field === 'dailyTarget' ? '1日' : '1週間'}の目標量は0より大きい有限値にしてください`, '未設定はnullにしてください'));
    }
  }

  if (material.preferredCadence?.type === 'timesPerWeek'
    && (!isSafeIntegerAtLeast(material.preferredCadence.count, 1) || material.preferredCadence.count > 7)) {
    issues.push(issue('preferredCadence.count', material.preferredCadence.count, '週あたり回数は1〜7回の整数にしてください', '1〜7を指定してください'));
  }
  if (!Array.isArray(material.reviewIntervals)
    || material.reviewIntervals.some((value) => !isSafeIntegerAtLeast(value, 1))) {
    issues.push(issue('reviewIntervals', material.reviewIntervals, '復習間隔は正の整数で入力してください', '例: 1, 3, 7, 14, 30'));
  }

  return issues;
}

export function materialIntegrityValidationIssues(materials: Material[]): ValidationIssue[] {
  return materials.flatMap((material) => validateMaterialIntegrity(material).map((entry) => ({
    targetId: material.id,
    field: entry.field,
    value: entry.value,
    reason: entry.reason,
    suggestion: entry.suggestion,
  })));
}

const EMPTY_OBJECTIVE = {
  strictDeadlineViolations: 0,
  lockViolations: 0,
  unscheduledStrictMinutes: 0,
  progressDebtMinutes: 0,
  normalOverdueMinutes: 0,
  unscheduledMinutes: 0,
  subjectImbalance: 0,
  timePreferenceViolations: 0,
  taskSwitches: 0,
  sameMaterialStreak: 0,
  maxDailyMinutes: 0,
  dailyLoadVariance: 0,
  adjacentDayDifference: 0,
  consecutiveHeavyDays: 0,
  subjectConcentration: 0,
  materialConcentration: 0,
  cadenceViolations: 0,
  dailyTargetDeviation: 0,
  weeklyTargetDeviation: 0,
  safetyBufferViolationMinutes: 0,
};

export function invalidMaterialScheduleResult(
  context: SchedulerContext,
  errors: ValidationIssue[],
): ScheduleGenerationResult {
  const start = toISODate(context.now, context.timezone);
  return {
    status: 'invalidInput',
    scheduledTasks: [],
    unscheduledWork: [],
    conflicts: [],
    warnings: [],
    progressDeficits: [],
    capacityReport: { horizonStart: start, horizonEnd: start, requiredMinutes: 0, availableMinutes: 0, shortages: [] },
    deadlineReports: [],
    objectiveReport: { ...EMPTY_OBJECTIVE },
    validationErrors: errors,
    generatedAt: context.now.toISOString(),
    generationId: context.generationId,
  };
}
