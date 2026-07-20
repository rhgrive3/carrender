import type {
  Assessment,
  ExerciseType,
  MemoryAttempt,
  MemoryMode,
  MemoryStat,
  MemoryTargetType,
} from './types';
import { MASTERY_MODE_WEIGHTS, MEMORY_MODES } from './types';

export function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function statKey(targetType: MemoryTargetType, targetId: string, mode: MemoryMode): string {
  return `${targetType}\u0000${targetId}\u0000${mode}`;
}

/** Null explicitly means that the mode has never been attempted. */
export function masteryForStat(stat: MemoryStat | undefined): number | null {
  if (!stat || stat.attempts <= 0) return null;
  return clamp((stat.correctCount + stat.partialCount * 0.5) / stat.attempts);
}

export interface ModeMasterySummary {
  mastery: number | null;
  attempts: number;
  correctCount: number;
  partialCount: number;
  incorrectCount: number;
  skippedCount: number;
}

export function aggregateModeMastery(
  stats: readonly MemoryStat[],
  mode: MemoryMode,
): ModeMasterySummary {
  const matching = stats.filter((stat) => stat.mode === mode && stat.attempts > 0);
  const attempts = matching.reduce((sum, stat) => sum + stat.attempts, 0);
  const correctCount = matching.reduce((sum, stat) => sum + stat.correctCount, 0);
  const partialCount = matching.reduce((sum, stat) => sum + stat.partialCount, 0);
  const incorrectCount = matching.reduce((sum, stat) => sum + stat.incorrectCount, 0);
  const skippedCount = matching.reduce((sum, stat) => sum + stat.skippedCount, 0);
  return {
    mastery: attempts === 0 ? null : clamp((correctCount + partialCount * 0.5) / attempts),
    attempts,
    correctCount,
    partialCount,
    incorrectCount,
    skippedCount,
  };
}

export interface MasterySummary {
  byMode: Record<MemoryMode, ModeMasterySummary>;
  /** Output/Context-heavy aggregate; null when every mode is unattempted. */
  overall: number | null;
}

export function aggregateMastery(
  stats: readonly MemoryStat[],
  weights: Readonly<Record<MemoryMode, number>> = MASTERY_MODE_WEIGHTS,
): MasterySummary {
  const byMode = Object.fromEntries(
    MEMORY_MODES.map((mode) => [mode, aggregateModeMastery(stats, mode)]),
  ) as unknown as Record<MemoryMode, ModeMasterySummary>;
  let weighted = 0;
  let denominator = 0;
  for (const mode of MEMORY_MODES) {
    const mastery = byMode[mode].mastery;
    if (mastery === null) continue;
    const weight = Math.max(0, weights[mode]);
    weighted += mastery * weight;
    denominator += weight;
  }
  return { byMode, overall: denominator === 0 ? null : clamp(weighted / denominator) };
}

export function createEmptyStat(input: {
  id: string;
  targetType: MemoryTargetType;
  targetId: string;
  mode: MemoryMode;
  now: string;
}): MemoryStat {
  return {
    id: input.id,
    targetType: input.targetType,
    targetId: input.targetId,
    mode: input.mode,
    attempts: 0,
    correctCount: 0,
    partialCount: 0,
    incorrectCount: 0,
    skippedCount: 0,
    consecutiveCorrect: 0,
    consecutiveIncorrect: 0,
    averageResponseMs: 0,
    hintCount: 0,
    manualWeak: false,
    weaknessScore: 0,
    updatedAt: input.now,
  };
}

/** Applies one append-only attempt without mutating the previous aggregate. */
export function applyAttemptToStat(
  stat: MemoryStat,
  attempt: Pick<MemoryAttempt, 'assessment' | 'hintUsed' | 'responseMs' | 'createdAt'>,
): MemoryStat {
  const attempts = stat.attempts + 1;
  const responseMs = Math.max(0, Number.isFinite(attempt.responseMs) ? attempt.responseMs : 0);
  const averageResponseMs = stat.attempts === 0
    ? responseMs
    : stat.averageResponseMs + (responseMs - stat.averageResponseMs) / attempts;
  const correct = attempt.assessment === 'correct';
  const incorrect = attempt.assessment === 'incorrect' || attempt.assessment === 'skipped';
  return {
    ...stat,
    attempts,
    correctCount: stat.correctCount + (correct ? 1 : 0),
    partialCount: stat.partialCount + (attempt.assessment === 'partial' ? 1 : 0),
    incorrectCount: stat.incorrectCount + (attempt.assessment === 'incorrect' ? 1 : 0),
    skippedCount: stat.skippedCount + (attempt.assessment === 'skipped' ? 1 : 0),
    consecutiveCorrect: correct ? stat.consecutiveCorrect + 1 : 0,
    consecutiveIncorrect: incorrect ? stat.consecutiveIncorrect + 1 : 0,
    averageResponseMs,
    hintCount: stat.hintCount + (attempt.hintUsed ? 1 : 0),
    lastAttemptAt: attempt.createdAt,
    updatedAt: attempt.createdAt,
  };
}

const RESPONSE_BASE_MS: Readonly<Record<ExerciseType, number>> = {
  flashcard: 3_500,
  typed_output: 7_000,
  fill_blank: 6_000,
  reorder: 8_000,
  multiple_choice: 4_500,
  guided_composition: 14_000,
  free_composition: 24_000,
};

export interface ResponseTimeContext {
  exerciseType: ExerciseType;
  promptLength?: number;
  expectedAnswerLength?: number;
}

/**
 * Converts response time to 0..1 relative difficulty. Composition and long prompts
 * receive materially larger baselines, so raw duration alone cannot mark them weak.
 */
export function normalizedResponseTime(
  responseMs: number,
  context: ResponseTimeContext,
): number {
  const promptLength = Math.max(0, context.promptLength ?? 0);
  const answerLength = Math.max(0, context.expectedAnswerLength ?? 0);
  const composition = context.exerciseType === 'guided_composition' || context.exerciseType === 'free_composition';
  const baseline = RESPONSE_BASE_MS[context.exerciseType]
    + promptLength * (composition ? 90 : 24)
    + answerLength * (composition ? 170 : context.exerciseType === 'typed_output' ? 95 : 35);
  if (baseline <= 0) return 0;
  // Up to the expected baseline carries little penalty. Three times baseline is max.
  return clamp((Math.max(0, responseMs) / baseline - 0.8) / 2.2);
}

const RECENCY_WEIGHTS = [5, 4, 3, 2, 1] as const;

function missValue(assessment: Assessment): number {
  switch (assessment) {
    case 'correct': return 0;
    case 'partial': return 0.5;
    case 'incorrect': return 1;
    case 'skipped': return 1;
  }
}

export function recentMissScore(
  attemptsNewestFirst: readonly Pick<MemoryAttempt, 'assessment'>[],
): number {
  const recent = attemptsNewestFirst.slice(0, RECENCY_WEIGHTS.length);
  if (recent.length === 0) return 0;
  let weighted = 0;
  let denominator = 0;
  recent.forEach((attempt, index) => {
    const weight = RECENCY_WEIGHTS[index];
    weighted += missValue(attempt.assessment) * weight;
    denominator += weight;
  });
  return denominator === 0 ? 0 : clamp(weighted / denominator);
}

export interface WeaknessInput {
  stat: MemoryStat;
  attemptsNewestFirst?: readonly Pick<MemoryAttempt, 'assessment'>[];
  responseContext: ResponseTimeContext;
  /** Mastery values are 0..1; null/undefined means no evidence. */
  inputMastery?: number | null;
  outputMastery?: number | null;
  contextMastery?: number | null;
}

export interface WeaknessComponents {
  adjustedErrorRate: number;
  recentMissScore: number;
  normalizedResponseTime: number;
  hintRate: number;
  directionGap: number;
  lowEvidenceScore: number;
  manualWeakScore: number;
}

export interface WeaknessResult {
  score: number;
  components: WeaknessComponents;
}

export function directionGap(input: Pick<WeaknessInput, 'stat' | 'inputMastery' | 'outputMastery' | 'contextMastery'>): number {
  if (input.stat.mode === 'output') {
    return clamp((input.inputMastery ?? 0) - (input.outputMastery ?? 0));
  }
  if (input.stat.mode === 'context') {
    return clamp((input.outputMastery ?? 0) - (input.contextMastery ?? 0));
  }
  return 0;
}

export function computeWeakness(input: WeaknessInput): WeaknessResult {
  const stat = input.stat;
  const components: WeaknessComponents = {
    adjustedErrorRate: clamp((stat.incorrectCount + stat.partialCount * 0.5 + 1) / (stat.attempts + 3)),
    recentMissScore: recentMissScore(input.attemptsNewestFirst ?? []),
    normalizedResponseTime: normalizedResponseTime(stat.averageResponseMs, input.responseContext),
    hintRate: stat.attempts === 0 ? 0 : clamp(stat.hintCount / stat.attempts),
    directionGap: directionGap(input),
    lowEvidenceScore: clamp(1 - stat.attempts / 5),
    manualWeakScore: stat.manualWeak ? 1 : 0,
  };
  const weighted =
    0.32 * components.adjustedErrorRate
    + 0.18 * components.recentMissScore
    + 0.12 * components.normalizedResponseTime
    + 0.1 * components.hintRate
    + 0.12 * components.directionGap
    + 0.08 * components.lowEvidenceScore
    + 0.08 * components.manualWeakScore;
  return { score: Math.round(100 * clamp(weighted) * 100) / 100, components };
}
