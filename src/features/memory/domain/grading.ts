import type { Assessment, ErrorType, MemoryAnswer, MemoryExercise } from './types';
import {
  containsNormalizedToken,
  damerauLevenshteinDistance,
  matchesAnswerPattern,
  normalizeAnswerText,
  tokenizeAnswer,
} from './normalization';

export type AnswerMatchKind =
  | 'exact'
  | 'normalized'
  | 'accepted_variant'
  | 'orthographic_variant'
  | 'pattern'
  | 'spelling_suggestion'
  | 'registered_other_answer'
  | 'unregistered'
  | 'empty';

export interface GradeResult {
  assessment: Assessment;
  matchKind: AnswerMatchKind;
  normalizedAnswer: string;
  matchedAnswerId?: string;
  suggestedAnswerId?: string;
  suggestedAnswer?: string;
  errorTypes: ErrorType[];
  needsUserConfirmation: boolean;
  missingRequiredTokens: string[];
  presentForbiddenTokens: string[];
}

export interface GradeAnswerInput {
  userAnswer: string;
  /** Answers that are correct for this exact sense/exercise context. */
  eligibleAnswers: readonly MemoryAnswer[];
  /** All registered answers, including other senses and context-excluded answers. */
  allKnownAnswers?: readonly MemoryAnswer[];
  exercise?: Pick<MemoryExercise, 'requiredTokens' | 'forbiddenTokens'> & { type?: MemoryExercise['type'] };
}

export interface GradeInputMeaningInput {
  userAnswer: string;
  /** Japanese meanings registered for the exact Sense being asked. */
  eligibleMeanings: readonly string[];
}

const CONFUSABLE_PAIRS = new Set([
  'adapt\u0000adopt',
  'adopt\u0000adapt',
  'affect\u0000effect',
  'effect\u0000affect',
  'moral\u0000morale',
  'morale\u0000moral',
]);

interface CandidateForm {
  answer: MemoryAnswer;
  value: string;
  normalized: string;
  kind: Exclude<AnswerMatchKind, 'spelling_suggestion' | 'registered_other_answer' | 'unregistered' | 'empty'>;
}

function candidateForms(answer: MemoryAnswer): CandidateForm[] {
  const forms: CandidateForm[] = [
    { answer, value: answer.displayForm, normalized: normalizeAnswerText(answer.displayForm), kind: 'normalized' },
  ];
  if (answer.citationForm !== answer.displayForm) {
    forms.push({ answer, value: answer.citationForm, normalized: normalizeAnswerText(answer.citationForm), kind: 'normalized' });
  }
  forms.push(
    ...answer.acceptedVariants.map((value) => ({
      answer,
      value,
      normalized: normalizeAnswerText(value),
      kind: 'accepted_variant' as const,
    })),
    ...answer.orthographicVariants.map((value) => ({
      answer,
      value,
      normalized: normalizeAnswerText(value),
      kind: 'orthographic_variant' as const,
    })),
  );
  return forms;
}

function exactRawMatch(userAnswer: string, answers: readonly MemoryAnswer[]): MemoryAnswer | undefined {
  return answers.find((answer) =>
    [answer.displayForm, answer.citationForm]
      .some((candidate) => candidate === userAnswer),
  );
}

function constraintErrors(
  userAnswer: string,
  exercise: Pick<MemoryExercise, 'requiredTokens' | 'forbiddenTokens'> | undefined,
): Pick<GradeResult, 'missingRequiredTokens' | 'presentForbiddenTokens'> {
  return {
    missingRequiredTokens: (exercise?.requiredTokens ?? []).filter(
      (token) => !containsNormalizedToken(userAnswer, token),
    ),
    presentForbiddenTokens: (exercise?.forbiddenTokens ?? []).filter(
      (token) => containsNormalizedToken(userAnswer, token),
    ),
  };
}

function isConservativeSpellingSuggestion(user: string, candidate: string): boolean {
  if (user === '' || candidate === '' || CONFUSABLE_PAIRS.has(`${user}\u0000${candidate}`)) return false;
  const userTokens = tokenizeAnswer(user);
  const candidateTokens = tokenizeAnswer(candidate);
  if (userTokens.length !== candidateTokens.length) return false;

  const differing = candidateTokens
    .map((token, index) => ({ candidate: token, user: userTokens[index] ?? '' }))
    .filter(({ candidate: token, user: value }) => token !== value);
  if (differing.length !== 1) return false;

  const difference = differing[0];
  // Short real words produce too many dangerous pairs. Longer answers permit two
  // edits only when the candidate token itself is long enough to be distinctive.
  const distance = damerauLevenshteinDistance(difference.user, difference.candidate);
  if (distance === 1) return difference.candidate.length >= 7;
  return distance === 2 && difference.candidate.length >= 11;
}

function likelyWordFormPair(left: string, right: string): boolean {
  const first = normalizeAnswerText(left);
  const second = normalizeAnswerText(right);
  if (!first || !second || first.includes(' ') || second.includes(' ')) return false;
  const forms = (base: string) => new Set([
    base,
    `${base}s`,
    `${base}es`,
    `${base}ed`,
    `${base}d`,
    `${base}ing`,
    base.endsWith('y') ? `${base.slice(0, -1)}ied` : '',
    base.endsWith('e') ? `${base.slice(0, -1)}ing` : '',
    base.length > 2 ? `${base}${base.charAt(base.length - 1)}ed` : '',
    base.length > 2 ? `${base}${base.charAt(base.length - 1)}ing` : '',
  ]);
  return forms(first).has(second) || forms(second).has(first);
}

function baseResult(userAnswer: string): Pick<
  GradeResult,
  'normalizedAnswer' | 'missingRequiredTokens' | 'presentForbiddenTokens'
> {
  return {
    normalizedAnswer: normalizeAnswerText(userAnswer),
    missingRequiredTokens: [],
    presentForbiddenTokens: [],
  };
}

export function gradeAnswer(input: GradeAnswerInput): GradeResult {
  const base = baseResult(input.userAnswer);
  const normalized = base.normalizedAnswer;
  if (normalized === '') {
    return {
      ...base,
      assessment: 'skipped',
      matchKind: 'empty',
      errorTypes: ['recall'],
      needsUserConfirmation: false,
    };
  }

  const constraints = constraintErrors(input.userAnswer, input.exercise);
  if ((input.exercise?.type === 'fill_blank' || input.exercise?.type === 'reorder')
    && input.exercise.requiredTokens?.length === 1) {
    const expected = input.exercise.requiredTokens[0];
    if (normalizeAnswerText(expected) === normalized
      && constraints.presentForbiddenTokens.length === 0) {
      return {
        ...base,
        ...constraints,
        missingRequiredTokens: [],
        assessment: 'correct',
        matchKind: 'normalized',
        matchedAnswerId: input.eligibleAnswers[0]?.id,
        errorTypes: [],
        needsUserConfirmation: false,
      };
    }
    if (likelyWordFormPair(input.userAnswer, expected)) {
      return {
        ...base,
        ...constraints,
        assessment: 'partial',
        matchKind: 'unregistered',
        matchedAnswerId: input.eligibleAnswers[0]?.id,
        suggestedAnswer: expected,
        errorTypes: ['word_form'],
        needsUserConfirmation: false,
      };
    }
  }
  const rawMatch = exactRawMatch(input.userAnswer, input.eligibleAnswers);
  if (rawMatch && constraints.missingRequiredTokens.length === 0 && constraints.presentForbiddenTokens.length === 0) {
    return {
      ...base,
      ...constraints,
      assessment: 'correct',
      matchKind: 'exact',
      matchedAnswerId: rawMatch.id,
      errorTypes: [],
      needsUserConfirmation: false,
    };
  }

  for (const answer of input.eligibleAnswers) {
    for (const form of candidateForms(answer)) {
      if (form.normalized !== normalized) continue;
      if (constraints.missingRequiredTokens.length > 0 || constraints.presentForbiddenTokens.length > 0) {
        return {
          ...base,
          ...constraints,
          assessment: 'incorrect',
          matchKind: form.kind,
          matchedAnswerId: answer.id,
          errorTypes: ['context'],
          needsUserConfirmation: false,
        };
      }
      return {
        ...base,
        ...constraints,
        assessment: 'correct',
        matchKind: form.kind,
        matchedAnswerId: answer.id,
        errorTypes: [],
        needsUserConfirmation: false,
      };
    }
    if (answer.pattern && matchesAnswerPattern(input.userAnswer, answer.pattern)) {
      if (constraints.missingRequiredTokens.length > 0 || constraints.presentForbiddenTokens.length > 0) {
        return {
          ...base,
          ...constraints,
          assessment: 'incorrect',
          matchKind: 'pattern',
          matchedAnswerId: answer.id,
          errorTypes: ['context'],
          needsUserConfirmation: false,
        };
      }
      return {
        ...base,
        ...constraints,
        assessment: 'correct',
        matchKind: 'pattern',
        matchedAnswerId: answer.id,
        errorTypes: [],
        needsUserConfirmation: false,
      };
    }
  }

  // A registered expression from another sense/context is a real competing answer,
  // never a typo. This check happens before edit-distance suggestions.
  const eligibleIds = new Set(input.eligibleAnswers.map((answer) => answer.id));
  const registeredOther = (input.allKnownAnswers ?? [])
    .filter((answer) => !eligibleIds.has(answer.id))
    .find((answer) => candidateForms(answer).some((form) => form.normalized === normalized));
  if (registeredOther) {
    return {
      ...base,
      ...constraints,
      assessment: 'incorrect',
      matchKind: 'registered_other_answer',
      suggestedAnswerId: registeredOther.id,
      suggestedAnswer: registeredOther.displayForm,
      errorTypes: ['context'],
      needsUserConfirmation: false,
    };
  }

  const spellingCandidate = input.eligibleAnswers
    .flatMap(candidateForms)
    .filter((candidate) => isConservativeSpellingSuggestion(normalized, candidate.normalized))
    .sort((left, right) =>
      damerauLevenshteinDistance(normalized, left.normalized)
      - damerauLevenshteinDistance(normalized, right.normalized),
    )[0];
  if (spellingCandidate) {
    const violatesExercise = constraints.missingRequiredTokens.length > 0
      || constraints.presentForbiddenTokens.length > 0;
    return {
      ...base,
      ...constraints,
      assessment: violatesExercise ? 'incorrect' : 'partial',
      matchKind: 'spelling_suggestion',
      suggestedAnswerId: spellingCandidate.answer.id,
      suggestedAnswer: spellingCandidate.value,
      errorTypes: violatesExercise ? ['spelling', 'context'] : ['spelling'],
      needsUserConfirmation: false,
    };
  }

  return {
    ...base,
    ...constraints,
    assessment: 'incorrect',
    matchKind: 'unregistered',
    errorTypes: constraints.missingRequiredTokens.length > 0 || constraints.presentForbiddenTokens.length > 0
      ? ['context']
      : ['meaning'],
    needsUserConfirmation: true,
  };
}

/** Grades an English-to-Japanese typed response without consulting English Answers. */
export function gradeInputMeaning(input: GradeInputMeaningInput): GradeResult {
  const base = baseResult(input.userAnswer);
  if (base.normalizedAnswer === '') {
    return {
      ...base,
      assessment: 'skipped',
      matchKind: 'empty',
      errorTypes: ['meaning'],
      needsUserConfirmation: false,
    };
  }
  const meanings = [...new Set(input.eligibleMeanings.map((value) => value.trim()).filter(Boolean))];
  const exact = meanings.includes(input.userAnswer);
  const normalized = meanings.some((value) => normalizeAnswerText(value) === base.normalizedAnswer);
  if (exact || normalized) {
    return {
      ...base,
      assessment: 'correct',
      matchKind: exact ? 'exact' : 'normalized',
      errorTypes: [],
      needsUserConfirmation: false,
    };
  }
  // Japanese paraphrases cannot be safely rejected from edit distance alone.
  return {
    ...base,
    assessment: 'incorrect',
    matchKind: 'unregistered',
    suggestedAnswer: meanings[0],
    errorTypes: ['meaning'],
    needsUserConfirmation: true,
  };
}

export type UnregisteredResolution = 'accept_once' | 'add_answer' | 'reject';

export interface UnregisteredResolutionResult {
  assessment: 'correct' | 'incorrect';
  shouldAddAnswer: boolean;
}

export function resolveUnregisteredAnswer(resolution: UnregisteredResolution): UnregisteredResolutionResult {
  return resolution === 'reject'
    ? { assessment: 'incorrect', shouldAddAnswer: false }
    : { assessment: 'correct', shouldAddAnswer: resolution === 'add_answer' };
}

export interface CompositionCheckResult {
  normalizedAnswer: string;
  missingRequiredTokens: string[];
  presentForbiddenTokens: string[];
  requiresSelfAssessment: true;
}

/** Free composition is intentionally never assigned a final automatic grade. */
export function inspectCompositionAnswer(
  userAnswer: string,
  exercise: Pick<MemoryExercise, 'requiredTokens' | 'forbiddenTokens'>,
): CompositionCheckResult {
  return {
    normalizedAnswer: normalizeAnswerText(userAnswer),
    ...constraintErrors(userAnswer, exercise),
    requiresSelfAssessment: true,
  };
}
