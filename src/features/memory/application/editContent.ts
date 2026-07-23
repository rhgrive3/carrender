import type {
  MemoryAnswer,
  MemoryContentBundle,
  MemoryExample,
  MemoryExercise,
  MemoryItem,
  MemoryItemKind,
  MemorySense,
  MemorySetMember,
} from '../domain/types';
import {
  isUsableEnglishMemoryText,
  normalizeEnglishCitationForm,
  normalizeMemoryCardText,
} from '../domain/cardIntegrity';
import { createMemoryId, MemoryRepository, type MemoryMutationOperation } from '../infrastructure/repositories';
import { selectValidMemorySenseDrafts } from './validateMemorySenseDrafts';

export interface MemoryAnswerDraft {
  id?: string;
  displayForm: string;
  citationForm?: string;
  pattern?: string;
  acceptedVariants?: string;
  orthographicVariants?: string;
  register?: MemoryAnswer['register'];
  nuance?: string;
  note?: string;
}

export interface MemoryExampleDraft {
  id?: string;
  english: string;
  japanese?: string;
  note?: string;
  answerId?: string;
}

export interface MemoryExerciseDraft {
  id?: string;
  type: MemoryExercise['type'];
  prompt: string;
  context?: string;
  /** Indexes refer to the answers in the surrounding Sense draft. */
  answerIndex?: number;
  acceptedAnswerIndexes?: number[];
  requiredTokens?: string;
  forbiddenTokens?: string;
  explanation?: string;
  hint?: string;
}

export interface MemorySenseDraft {
  id?: string;
  siblingGroupId?: string;
  promptJa: string;
  meaningJa?: string;
  explanation?: string;
  tags?: string;
  answers: MemoryAnswerDraft[];
  examples: MemoryExampleDraft[];
  exercises?: MemoryExerciseDraft[];
}

export interface MemoryItemDraft {
  id?: string;
  kind: MemoryItemKind;
  label?: string;
  lemma?: string;
  tags?: string;
  senses: MemorySenseDraft[];
}

function splitList(value: string | undefined): string[] {
  return [...new Set((value ?? '').split(/[,、\n]/u).map((part) => part.trim()).filter(Boolean))];
}

function compareCreatedRecords(
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string },
): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function firstOriginalAnswerForItem(
  original: MemoryContentBundle | undefined,
  itemId: string,
): MemoryAnswer | undefined {
  if (!original) return undefined;
  const firstSense = original.senses
    .filter((sense) => sense.itemId === itemId && !sense.deletedAt)
    .sort(compareCreatedRecords)[0];
  if (!firstSense) return undefined;
  return original.answers
    .filter((answer) => answer.senseId === firstSense.id && !answer.deletedAt)
    .sort(compareCreatedRecords)[0];
}

function itemFieldWasAutoDerived(value: string | undefined, answer: MemoryAnswer | undefined): boolean {
  const key = normalizeMemoryCardText(value);
  if (!key || !answer) return false;
  const displayKey = normalizeMemoryCardText(answer.displayForm);
  const citationKey = normalizeMemoryCardText(
    normalizeEnglishCitationForm(answer.displayForm, answer.citationForm),
  );
  return key === displayKey || key === citationKey;
}

function resolveHiddenItemEnglishField(input: {
  draftValue: string | undefined;
  originalValue: string | undefined;
  originalFirstAnswer: MemoryAnswer | undefined;
  nextFirstEnglish: string;
}): string {
  const draftValue = input.draftValue?.trim() ?? '';
  if (!isUsableEnglishMemoryText(draftValue)) return input.nextFirstEnglish;
  const draftStillMatchesOriginal = normalizeMemoryCardText(draftValue)
    === normalizeMemoryCardText(input.originalValue);
  if (draftStillMatchesOriginal && itemFieldWasAutoDerived(input.originalValue, input.originalFirstAnswer)) {
    return input.nextFirstEnglish;
  }
  return draftValue;
}

function draftOwnershipError(label: string): Error {
  return new Error(`${label}の保存先が元データと一致しません。画面を再読み込みしてからやり直してください`);
}

/**
 * Existing IDs are immutable identities. A stale/imported draft must never move
 * an entity to another Item or Sense by reusing its revision and changing only
 * the relation field.
 */
export function validateMemoryDraftOwnership(
  draft: MemoryItemDraft,
  original: MemoryContentBundle | undefined,
  itemId: string,
): void {
  if (!original) return;
  const sensesById = new Map(original.senses.map((sense) => [sense.id, sense]));
  const answersById = new Map(original.answers.map((answer) => [answer.id, answer]));
  const examplesById = new Map(original.examples.map((example) => [example.id, example]));
  const exercisesById = new Map(original.exercises.map((exercise) => [exercise.id, exercise]));

  for (const [senseIndex, senseDraft] of draft.senses.entries()) {
    const senseLabel = `意味${senseIndex + 1}`;
    const originalSense = senseDraft.id ? sensesById.get(senseDraft.id) : undefined;
    if (senseDraft.id && (!originalSense || originalSense.itemId !== itemId)) {
      throw draftOwnershipError(senseLabel);
    }
    const expectedSenseId = originalSense?.id;

    for (const [answerIndex, answerDraft] of senseDraft.answers.entries()) {
      if (!answerDraft.id) continue;
      const originalAnswer = answersById.get(answerDraft.id);
      if (!expectedSenseId || !originalAnswer || originalAnswer.senseId !== expectedSenseId) {
        throw draftOwnershipError(`${senseLabel}の英語${answerIndex + 1}`);
      }
    }
    for (const [exampleIndex, exampleDraft] of senseDraft.examples.entries()) {
      if (!exampleDraft.id) continue;
      const originalExample = examplesById.get(exampleDraft.id);
      if (!expectedSenseId || !originalExample || originalExample.senseId !== expectedSenseId) {
        throw draftOwnershipError(`${senseLabel}の例文${exampleIndex + 1}`);
      }
    }
    for (const [exerciseIndex, exerciseDraft] of (senseDraft.exercises ?? []).entries()) {
      if (!exerciseDraft.id) continue;
      const originalExercise = exercisesById.get(exerciseDraft.id);
      if (!expectedSenseId || !originalExercise || originalExercise.senseId !== expectedSenseId) {
        throw draftOwnershipError(`${senseLabel}の問題${exerciseIndex + 1}`);
      }
    }
  }
}

function revisionedEntity(
  entityType: 'item' | 'sense' | 'answer' | 'example' | 'exercise',
  value: { id: string; revision: number },
  isNew: boolean,
) {
  return {
    entityType,
    entityId: value.id,
    value,
    operation: (isNew ? 'create' : 'update') as MemoryMutationOperation,
    baseRevision: isNew ? 0 : value.revision - 1,
  };
}

export async function saveMemoryItemDraft(input: {
  repository: MemoryRepository;
  draft: MemoryItemDraft;
  original?: MemoryContentBundle;
  setId?: string;
  setOrder?: number;
}): Promise<string> {
  const validSenses = selectValidMemorySenseDrafts(input.draft.senses, '意味');
  if (validSenses.length === 0) throw new Error('日本語の意味を1つ以上入力してください');
  if (validSenses.some((sense) => !sense.answers.some((answer) => answer.displayForm.trim()))) {
    throw new Error('各意味に英語表現を1つ以上入力してください');
  }
  const originalItem = input.original?.items.find((item) => item.id === input.draft.id);
  const itemId = originalItem?.id ?? input.draft.id ?? createMemoryId('item');
  validateMemoryDraftOwnership(input.draft, input.original, itemId);
  const now = new Date().toISOString();
  const isNewItem = !originalItem;
  const firstAnswer = validSenses[0].answers.find((answer) => answer.displayForm.trim());
  const firstCitationForm = firstAnswer
    ? normalizeEnglishCitationForm(firstAnswer.displayForm, firstAnswer.citationForm)
    : '';
  const originalFirstAnswer = firstOriginalAnswerForItem(input.original, itemId);
  const label = originalItem
    ? resolveHiddenItemEnglishField({
        draftValue: input.draft.label,
        originalValue: originalItem.label,
        originalFirstAnswer,
        nextFirstEnglish: firstCitationForm || firstAnswer?.displayForm.trim() || '',
      })
    : input.draft.label?.trim() || firstCitationForm || firstAnswer?.displayForm.trim() || '';
  const lemma = originalItem
    ? resolveHiddenItemEnglishField({
        draftValue: input.draft.lemma,
        originalValue: originalItem.lemma,
        originalFirstAnswer,
        nextFirstEnglish: firstCitationForm || firstAnswer?.displayForm.trim() || '',
      })
    : input.draft.lemma?.trim() || firstCitationForm || firstAnswer?.displayForm.trim() || '';
  const item: MemoryItem = {
    id: itemId,
    kind: input.draft.kind,
    label,
    lemma: lemma || undefined,
    tags: splitList(input.draft.tags),
    source: originalItem?.source ?? 'user',
    verificationStatus: originalItem?.verificationStatus ?? 'verified',
    createdAt: originalItem?.createdAt ?? now,
    updatedAt: now,
    revision: (originalItem?.revision ?? 0) + 1,
  };
  const entities: Parameters<MemoryRepository['saveEntities']>[0] = [revisionedEntity('item', item, isNewItem)];
  const retainedSenseIds = new Set<string>();
  const retainedAnswerIds = new Set<string>();
  const retainedExampleIds = new Set<string>();
  const retainedExerciseIds = new Set<string>();
  const itemSiblingGroupId = input.original?.senses.find((sense) => sense.itemId === itemId)?.siblingGroupId
    ?? validSenses.find((sense) => sense.siblingGroupId)?.siblingGroupId
    ?? createMemoryId('sibling');

  for (const senseDraft of validSenses) {
    const originalSense = input.original?.senses.find((sense) => sense.id === senseDraft.id);
    const senseId = originalSense?.id ?? senseDraft.id ?? createMemoryId('sense');
    retainedSenseIds.add(senseId);
    const sense: MemorySense = {
      id: senseId,
      itemId,
      promptJa: senseDraft.promptJa.trim(),
      meaningJa: senseDraft.meaningJa?.trim() || senseDraft.promptJa.trim(),
      explanation: senseDraft.explanation?.trim() || undefined,
      // Every Sense and Exercise under an Item is a sibling for queue spacing.
      siblingGroupId: itemSiblingGroupId,
      tags: splitList(senseDraft.tags),
      source: originalSense?.source ?? 'user',
      verificationStatus: originalSense?.verificationStatus ?? 'verified',
      createdAt: originalSense?.createdAt ?? now,
      updatedAt: now,
      revision: (originalSense?.revision ?? 0) + 1,
    };
    entities.push(revisionedEntity('sense', sense, !originalSense));

    const answerIdByDraftIndex = new Map<number, string>();
    const retainedAnswerIdsForSense = new Set<string>();
    for (const [answerIndex, answerDraft] of senseDraft.answers.entries()) {
      if (!answerDraft.displayForm.trim()) continue;
      const originalAnswer = input.original?.answers.find((answer) => answer.id === answerDraft.id);
      const answerId = originalAnswer?.id ?? answerDraft.id ?? createMemoryId('answer');
      retainedAnswerIds.add(answerId);
      retainedAnswerIdsForSense.add(answerId);
      answerIdByDraftIndex.set(answerIndex, answerId);
      const answer: MemoryAnswer = {
        id: answerId,
        senseId,
        displayForm: answerDraft.displayForm.trim(),
        citationForm: normalizeEnglishCitationForm(answerDraft.displayForm, answerDraft.citationForm),
        pattern: answerDraft.pattern?.trim() || undefined,
        acceptedVariants: splitList(answerDraft.acceptedVariants),
        orthographicVariants: splitList(answerDraft.orthographicVariants),
        register: answerDraft.register,
        nuance: answerDraft.nuance?.trim() || undefined,
        note: answerDraft.note?.trim() || undefined,
        source: originalAnswer?.source ?? 'user',
        verificationStatus: originalAnswer?.verificationStatus ?? 'verified',
        createdAt: originalAnswer?.createdAt ?? now,
        updatedAt: now,
        revision: (originalAnswer?.revision ?? 0) + 1,
      };
      entities.push(revisionedEntity('answer', answer, !originalAnswer));
    }

    for (const exampleDraft of senseDraft.examples.filter((example) => example.english.trim())) {
      const originalExample = input.original?.examples.find((example) => example.id === exampleDraft.id);
      const exampleId = originalExample?.id ?? exampleDraft.id ?? createMemoryId('example');
      retainedExampleIds.add(exampleId);
      const answerId = originalExample
        ? originalExample.answerId && retainedAnswerIdsForSense.has(originalExample.answerId)
          ? originalExample.answerId
          : undefined
        : exampleDraft.answerId && retainedAnswerIdsForSense.has(exampleDraft.answerId)
          ? exampleDraft.answerId
          : answerIdByDraftIndex.size === 1 ? [...answerIdByDraftIndex.values()][0] : undefined;
      const example: MemoryExample = {
        id: exampleId,
        senseId,
        answerId,
        english: exampleDraft.english.trim(),
        japanese: exampleDraft.japanese?.trim() || undefined,
        note: exampleDraft.note?.trim() || undefined,
        source: originalExample?.source ?? 'user',
        verificationStatus: originalExample?.verificationStatus ?? 'verified',
        createdAt: originalExample?.createdAt ?? now,
        updatedAt: now,
        revision: (originalExample?.revision ?? 0) + 1,
      };
      entities.push(revisionedEntity('example', example, !originalExample));
    }

    for (const exerciseDraft of (senseDraft.exercises ?? []).filter((exercise) => exercise.prompt.trim())) {
      const originalExercise = input.original?.exercises.find((exercise) => exercise.id === exerciseDraft.id);
      const exerciseId = originalExercise?.id ?? exerciseDraft.id ?? createMemoryId('exercise');
      retainedExerciseIds.add(exerciseId);
      const answerId = originalExercise
        ? originalExercise.answerId && retainedAnswerIdsForSense.has(originalExercise.answerId)
          ? originalExercise.answerId
          : undefined
        : exerciseDraft.answerIndex === undefined
          ? undefined
          : answerIdByDraftIndex.get(exerciseDraft.answerIndex);
      const acceptedAnswerIds = originalExercise
        ? originalExercise.acceptedAnswerIds.filter((id) => retainedAnswerIdsForSense.has(id))
        : [...new Set((exerciseDraft.acceptedAnswerIndexes ?? [])
            .map((index) => answerIdByDraftIndex.get(index))
            .filter((id): id is string => Boolean(id)))];
      if (answerId && !acceptedAnswerIds.includes(answerId)) acceptedAnswerIds.push(answerId);
      const exercise: MemoryExercise = {
        id: exerciseId,
        senseId,
        answerId,
        type: exerciseDraft.type,
        prompt: exerciseDraft.prompt.trim(),
        context: exerciseDraft.context?.trim() || undefined,
        acceptedAnswerIds,
        requiredTokens: splitList(exerciseDraft.requiredTokens),
        forbiddenTokens: splitList(exerciseDraft.forbiddenTokens),
        explanation: exerciseDraft.explanation?.trim() || undefined,
        hint: exerciseDraft.hint?.trim() || undefined,
        siblingGroupId: itemSiblingGroupId,
        source: originalExercise?.source ?? 'user',
        verificationStatus: originalExercise?.verificationStatus ?? 'verified',
        createdAt: originalExercise?.createdAt ?? now,
        updatedAt: now,
        revision: (originalExercise?.revision ?? 0) + 1,
      };
      entities.push(revisionedEntity('exercise', exercise, !originalExercise));
    }
  }

  const tombstone = (
    entityType: 'sense' | 'answer' | 'example' | 'exercise',
    record: MemorySense | MemoryAnswer | MemoryExample | MemoryExercise,
  ) => {
    entities.push({
      entityType,
      entityId: record.id,
      value: { ...record, revision: record.revision + 1, updatedAt: now, deletedAt: now },
      operation: 'delete',
      baseRevision: record.revision,
    });
  };
  const originalItemSenseIds = new Set(
    input.original?.senses.filter((value) => value.itemId === itemId).map((sense) => sense.id) ?? [],
  );
  for (const sense of input.original?.senses.filter((value) => value.itemId === itemId) ?? []) {
    if (!retainedSenseIds.has(sense.id)) tombstone('sense', sense);
  }
  for (const answer of input.original?.answers ?? []) {
    if (originalItemSenseIds.has(answer.senseId)
      && (!retainedSenseIds.has(answer.senseId) || !retainedAnswerIds.has(answer.id))) {
      tombstone('answer', answer);
    }
  }
  for (const example of input.original?.examples ?? []) {
    if (originalItemSenseIds.has(example.senseId)
      && (!retainedSenseIds.has(example.senseId) || !retainedExampleIds.has(example.id))) {
      tombstone('example', example);
    }
  }
  for (const exercise of input.original?.exercises ?? []) {
    if (originalItemSenseIds.has(exercise.senseId)
      && (!retainedSenseIds.has(exercise.senseId) || !retainedExerciseIds.has(exercise.id))) {
      tombstone('exercise', exercise);
    }
  }

  if (isNewItem && input.setId) {
    const member: MemorySetMember = {
      setId: input.setId,
      itemId,
      order: input.setOrder ?? 0,
      createdAt: now,
    };
    entities.push({
      entityType: 'set_member',
      entityId: `${input.setId}:${itemId}`,
      value: member,
      operation: 'upsert',
    });
  }
  await input.repository.saveEntities(entities);
  return itemId;
}
