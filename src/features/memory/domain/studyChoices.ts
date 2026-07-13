import type {
  LearningTarget,
  MemoryAnswer,
  MemoryContentBundle,
} from './types';
import { normalizeAnswerText } from './normalization';

export interface InputMeaningChoice {
  senseId: string;
  label: string;
  correct: boolean;
}

function deterministicRank(seed: string, id: string): number {
  let hash = 0x811c9dc5;
  for (const character of `${seed}\u0000${id}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function deterministicOrder<T extends { id: string }>(values: readonly T[], seed: string): T[] {
  return [...values].sort((left, right) =>
    deterministicRank(seed, left.id) - deterministicRank(seed, right.id)
    || left.id.localeCompare(right.id));
}

/**
 * Builds Japanese choices for an ordinary Input target without creating a new
 * Exercise record. Target generation remains responsible for excluding an
 * ambiguous polysemous prompt unless it has Sense-specific context.
 */
export function buildInputMeaningChoices(input: {
  content: MemoryContentBundle;
  target: LearningTarget;
  seed: string;
  includeUnverifiedAi: boolean;
  maxChoices?: number;
}): InputMeaningChoice[] {
  if (input.target.mode !== 'input') return [];
  const current = input.content.senses.find((sense) =>
    sense.id === input.target.senseId && !sense.deletedAt);
  if (!current) return [];

  const items = new Map(input.content.items
    .filter((item) => !item.deletedAt)
    .map((item) => [item.id, item]));
  const correctLabel = current.promptJa.trim() || current.meaningJa.trim();
  const normalizedCorrect = normalizeAnswerText(correctLabel);
  if (!normalizedCorrect) return [];

  // Both fields are accepted when grading Input. Never expose the other valid
  // wording as a distractor merely because promptJa is the displayed label.
  const correctMeanings = new Set([
    normalizeAnswerText(current.promptJa),
    normalizeAnswerText(current.meaningJa),
  ].filter(Boolean));
  const rankedCandidates = deterministicOrder(
    input.content.senses.filter((sense) => {
      if (sense.deletedAt || sense.id === current.id) return false;
      const item = items.get(sense.itemId);
      if (!item) return false;
      if (!input.includeUnverifiedAi
        && (sense.verificationStatus !== 'verified' || item.verificationStatus !== 'verified')) return false;
      const normalized = normalizeAnswerText(sense.promptJa.trim() || sense.meaningJa.trim());
      return !!normalized && !correctMeanings.has(normalized);
    }).map((sense) => ({
      id: sense.id,
      senseId: sense.id,
      label: sense.promptJa.trim() || sense.meaningJa.trim(),
      correct: false,
    })),
    `${input.seed}:${input.target.id}:distractors`,
  );
  // Rank before deduplication so the winner for equal display text is stable
  // even when IndexedDB returns records in a different order.
  const seen = new Set(correctMeanings);
  const distractors: Array<InputMeaningChoice & { id: string }> = [];
  for (const candidate of rankedCandidates) {
    const normalized = normalizeAnswerText(candidate.label);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    distractors.push(candidate);
    if (distractors.length >= Math.max(0, (input.maxChoices ?? 4) - 1)) break;
  }

  return deterministicOrder([
    { id: current.id, senseId: current.id, label: correctLabel, correct: true },
    ...distractors.map((choice) => ({ ...choice, id: choice.senseId })),
  ], `${input.seed}:${input.target.id}:order`).map(({ id: _id, ...choice }) => choice);
}

function answerForms(answer: MemoryAnswer): Set<string> {
  return new Set([
    answer.displayForm,
    answer.citationForm,
    ...answer.acceptedVariants,
    ...answer.orthographicVariants,
  ].map(normalizeAnswerText).filter(Boolean));
}

/**
 * Produces safe English distractors for a concrete Exercise. Answers belonging
 * to the correct Sense, equivalent registered forms, and unverified AI content
 * are never used unless the session explicitly opted into unverified content.
 */
export function buildAnswerChoiceDistractors(input: {
  content: MemoryContentBundle;
  senseId: string;
  correctAnswers: readonly MemoryAnswer[];
  seed: string;
  includeUnverifiedAi: boolean;
  limit?: number;
}): MemoryAnswer[] {
  const senses = new Map(input.content.senses
    .filter((sense) => !sense.deletedAt)
    .map((sense) => [sense.id, sense]));
  const items = new Map(input.content.items
    .filter((item) => !item.deletedAt)
    .map((item) => [item.id, item]));
  const correctForms = new Set(input.correctAnswers.flatMap((answer) => [...answerForms(answer)]));
  const rankedCandidates = deterministicOrder(input.content.answers.filter((answer) => {
    if (answer.deletedAt || answer.senseId === input.senseId) return false;
    const sense = senses.get(answer.senseId);
    const item = sense ? items.get(sense.itemId) : undefined;
    if (!sense || !item) return false;
    if (!input.includeUnverifiedAi
      && (answer.verificationStatus !== 'verified'
        || sense.verificationStatus !== 'verified'
        || item.verificationStatus !== 'verified')) return false;
    if ([...answerForms(answer)].some((form) => correctForms.has(form))) return false;
    const display = normalizeAnswerText(answer.displayForm);
    return !!display;
  }), `${input.seed}:${input.senseId}:answer-distractors`);
  const seenDisplayForms = new Set<string>();
  const result: MemoryAnswer[] = [];
  for (const candidate of rankedCandidates) {
    const display = normalizeAnswerText(candidate.displayForm);
    if (seenDisplayForms.has(display)) continue;
    seenDisplayForms.add(display);
    result.push(candidate);
    if (result.length >= Math.max(0, input.limit ?? 3)) break;
  }
  return result;
}
