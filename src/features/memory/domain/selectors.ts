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

import {
  englishAnswersForSense,
  isUsableEnglishMemoryText,
  memoryTargetHasUsableLanguagePair,
  normalizeMemoryCardText,
  primaryEnglishForSense,
} from './cardIntegrity';
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

export type LearningTargetExclusionReason =
  | 'missingJapanese'
  | 'missingEnglish'
  | 'unverifiedAi'
  | 'unsupportedDirection'
  | 'brokenReference';

export interface LearningTargetEligibilityDiagnostic {
  eligibleCount: number;
  excludedCount: number;
  candidateCount: number;
  counts: Record<LearningTargetExclusionReason, number>;
  primaryReason?: LearningTargetExclusionReason;
}

export const LEARNING_TARGET_EXCLUSION_LABELS: Record<LearningTargetExclusionReason, string> = {
  missingJapanese: '日本語が未設定',
  missingEnglish: '英語が未設定',
  unverifiedAi: '未確認AIカード',
  unsupportedDirection: '選んだ出題方向に未対応',
  brokenReference: '削除済み・破損した参照',
};

/**
 * Uses the same target selector as session creation, then assigns one actionable
 * reason to every selected flashcard Sense that did not become eligible.
 */
export function diagnoseLearningTargetEligibility(
  input: GenerateLearningTargetsInput,
): LearningTargetEligibilityDiagnostic {
  const counts: Record<LearningTargetExclusionReason, number> = {
    missingJapanese: 0,
    missingEnglish: 0,
    unverifiedAi: 0,
    unsupportedDirection: 0,
    brokenReference: 0,
  };
  const includeUnverified = input.includeUnverifiedAi ?? false;
  const selectedSets = new Set(input.selectedSetIds);
  const selectedItemIds = [...new Set(input.setMembers
    .filter((member) => !member.deletedAt && selectedSets.has(member.setId))
    .map((member) => member.itemId))];
  const activeItems = new Map(input.content.items
    .filter((item) => !item.deletedAt)
    .map((item) => [item.id, item]));
  const activeSensesByItem = new Map<string, typeof input.content.senses>();
  for (const sense of input.content.senses) {
    if (sense.deletedAt) continue;
    const list = activeSensesByItem.get(sense.itemId) ?? [];
    list.push(sense);
    activeSensesByItem.set(sense.itemId, list);
  }
  const eligibleTargets = generateLearningTargets(input)
    .filter((target) => !target.exerciseId && (target.mode === 'input' || target.mode === 'output'));
  const eligibleSenseIds = new Set(eligibleTargets.map((target) => target.senseId));
  let candidateCount = 0;

  for (const itemId of selectedItemIds) {
    const item = activeItems.get(itemId);
    const senses = activeSensesByItem.get(itemId) ?? [];
    if (!item || senses.length === 0) {
      candidateCount += 1;
      counts.brokenReference += 1;
      continue;
    }
    for (const sense of senses) {
      candidateCount += 1;
      if (eligibleSenseIds.has(sense.id)) continue;
      if (!sense.promptJa.trim()) {
        counts.missingJapanese += 1;
        continue;
      }
      if (!includeUnverified
        && (item.verificationStatus !== 'verified' || sense.verificationStatus !== 'verified')) {
        counts.unverifiedAi += 1;
        continue;
      }

      if (input.direction === 'output') {
        const allAnswers = englishAnswersForSense(input.content, sense.id);
        const verifiedAnswers = englishAnswersForSense(input.content, sense.id, { verifiedOnly: true });
        if (allAnswers.length === 0) {
          counts.missingEnglish += 1;
          continue;
        }
        if (!includeUnverified && verifiedAnswers.length === 0) {
          counts.unverifiedAi += 1;
          continue;
        }
        counts.unsupportedDirection += 1;
        continue;
      }

      if (input.direction === 'input') {
        const anyEnglish = primaryEnglishForSense(input.content, sense.id);
        const verifiedEnglish = primaryEnglishForSense(input.content, sense.id, { verifiedOnly: true });
        if (!anyEnglish || !isUsableEnglishMemoryText(anyEnglish)
          || normalizeMemoryCardText(anyEnglish) === normalizeMemoryCardText(sense.promptJa)) {
          counts.missingEnglish += 1;
          continue;
        }
        if (!includeUnverified && !verifiedEnglish) {
          counts.unverifiedAi += 1;
          continue;
        }
        counts.unsupportedDirection += 1;
        continue;
      }

      counts.unsupportedDirection += 1;
    }
  }

  const excludedCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const primaryReason = (Object.entries(counts) as [LearningTargetExclusionReason, number][])
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1])[0]?.[0];
  return {
    eligibleCount: eligibleTargets.length,
    excludedCount,
    candidateCount,
    counts,
    primaryReason,
  };
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