export {
  automaticQuestionCount,
  makeLearningTargetId,
  modesForDirection,
  resolveQuestionCount,
  selectLearningTargets,
  selectionModeWeights,
} from './targets';
export type {
  GenerateLearningTargetsInput,
  SelectLearningTargetsInput,
} from './targets';

import { memoryTargetHasUsableLanguagePair } from './cardIntegrity';
import {
  generateLearningTargets as generateLearningTargetsBase,
  type GenerateLearningTargetsInput,
} from './targets';
import type {
  LearningTarget,
  MemoryMode,
  MemoryStat,
  MemoryTargetType,
} from './types';
import {
  aggregateMastery,
  statKey,
  type MasterySummary,
} from './weakness';

/**
 * All UI/session entry points import target generation through this module.
 * Structurally valid but malformed legacy records (for example Japanese copied
 * into the English field) remain editable, but can never become a study prompt.
 */
export function generateLearningTargets(input: GenerateLearningTargetsInput): LearningTarget[] {
  return generateLearningTargetsBase(input)
    .filter((target) => memoryTargetHasUsableLanguagePair(input.content, target));
}

export interface LearningTargetStatRef {
  targetType: MemoryTargetType;
  targetId: string;
  mode: MemoryMode;
  key: string;
}

export interface LearningTargetStatSelection extends LearningTargetStatRef {
  target: LearningTarget;
  stat?: MemoryStat;
}

/**
 * Returns the one aggregate that represents a Learning Target.
 *
 * Exercise attempts can also update an Answer aggregate, while ordinary output
 * can update both Sense and Answer aggregates. Picking the most concrete target
 * here prevents those auxiliary aggregates from being counted a second time in
 * set mastery and weakness summaries.
 */
export function statRefForLearningTarget(target: LearningTarget): LearningTargetStatRef {
  const targetType: MemoryTargetType = target.exerciseId
    ? 'exercise'
    : target.answerId
      ? 'answer'
      : 'sense';
  const targetId = target.exerciseId ?? target.answerId ?? target.senseId;
  return {
    targetType,
    targetId,
    mode: target.mode,
    key: statKey(targetType, targetId, target.mode),
  };
}

/**
 * Maps eligible targets to their representative stats, deduplicating both a
 * repeated Learning Target and multiple targets that resolve to the same stat.
 */
export function selectLearningTargetStatEntries(
  targets: readonly LearningTarget[],
  stats: readonly MemoryStat[],
): LearningTargetStatSelection[] {
  const statsByKey = new Map<string, MemoryStat>();
  for (const stat of stats) {
    const key = statKey(stat.targetType, stat.targetId, stat.mode);
    if (!statsByKey.has(key)) statsByKey.set(key, stat);
  }

  const seenTargetIds = new Set<string>();
  const seenStatKeys = new Set<string>();
  const selections: LearningTargetStatSelection[] = [];
  for (const target of targets) {
    if (seenTargetIds.has(target.id)) continue;
    seenTargetIds.add(target.id);
    const ref = statRefForLearningTarget(target);
    if (seenStatKeys.has(ref.key)) continue;
    seenStatKeys.add(ref.key);
    selections.push({ target, ...ref, stat: statsByKey.get(ref.key) });
  }
  return selections;
}

/** Selects only existing representative stats, with no duplicate aggregates. */
export function selectStatsForLearningTargets(
  targets: readonly LearningTarget[],
  stats: readonly MemoryStat[],
): MemoryStat[] {
  return selectLearningTargetStatEntries(targets, stats)
    .flatMap((selection) => selection.stat ? [selection.stat] : []);
}

export interface LearningTargetStatSummary {
  mastery: MasterySummary;
  totalTargetCount: number;
  /** Attempted representative Learning Targets. */
  attemptedCount: number;
  /** Unattempted representative Learning Targets. */
  unattemptedCount: number;
  /** Weak representative Learning Targets. */
  weakCount: number;
  totalSenseCount: number;
  attemptedSenseCount: number;
  unattemptedSenseCount: number;
  weakSenseCount: number;
}

export function summarizeLearningTargetStats(
  targets: readonly LearningTarget[],
  stats: readonly MemoryStat[],
  weakThreshold = 60,
): LearningTargetStatSummary {
  const selections = selectLearningTargetStatEntries(targets, stats);
  const selectedStats = selections.flatMap((selection) => selection.stat ? [selection.stat] : []);
  const attemptedCount = selections.filter((selection) => (selection.stat?.attempts ?? 0) > 0).length;
  const weakSelections = selections.filter((selection) =>
    Boolean(selection.stat?.manualWeak)
      || (selection.stat?.weaknessScore ?? 0) >= weakThreshold,
  );
  const senseIds = new Set(selections.map((selection) => selection.target.senseId));
  const attemptedSenseIds = new Set(
    selections
      .filter((selection) => (selection.stat?.attempts ?? 0) > 0)
      .map((selection) => selection.target.senseId),
  );
  const weakSenseIds = new Set(weakSelections.map((selection) => selection.target.senseId));
  return {
    mastery: aggregateMastery(selectedStats),
    totalTargetCount: selections.length,
    attemptedCount,
    unattemptedCount: selections.length - attemptedCount,
    weakCount: weakSelections.length,
    totalSenseCount: senseIds.size,
    attemptedSenseCount: attemptedSenseIds.size,
    unattemptedSenseCount: senseIds.size - attemptedSenseIds.size,
    weakSenseCount: weakSenseIds.size,
  };
}

export {
  aggregateMastery,
  aggregateModeMastery,
  masteryForStat,
} from './weakness';
