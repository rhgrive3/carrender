import { buildMemoryCard } from './content';
import type { MemoryItemDraft } from './editContent';
import { normalizeEnglishCitationForm } from '../domain/cardIntegrity';
import type { MemoryRepository } from '../infrastructure/repositories';

function splitList(value: string | undefined): string[] {
  return [...new Set((value ?? '').split(/[,、\n]/u).map((part) => part.trim()).filter(Boolean))];
}

/**
 * シンプル追加画面の各「カード」ブロックを、独立したItemとして一括保存する。
 * 複数Senseを持つ一Itemの編集はsaveMemoryItemDraftが担当し、この関数は新規追加専用。
 */
export async function saveNewMemoryItemCards(input: {
  repository: MemoryRepository;
  draft: MemoryItemDraft;
  setId?: string;
  setOrder?: number;
}): Promise<string[]> {
  const validSenses = input.draft.senses.filter((sense) => sense.promptJa.trim());
  if (validSenses.length === 0) throw new Error('日本語を1つ以上入力してください');
  if (validSenses.some((sense) => !sense.answers.some((answer) => answer.displayForm.trim()))) {
    throw new Error('各カードに英語表現を1つ以上入力してください');
  }

  const now = new Date().toISOString();
  const entities: Parameters<MemoryRepository['saveEntities']>[0] = [];
  const itemIds: string[] = [];

  validSenses.forEach((senseDraft, cardIndex) => {
    const answerEntries = senseDraft.answers
      .map((answer, originalIndex) => ({ answer, originalIndex }))
      .filter(({ answer }) => answer.displayForm.trim());
    const compactIndexByOriginal = new Map(answerEntries.map((entry, compactIndex) => [entry.originalIndex, compactIndex]));
    const compactIndexById = new Map(
      answerEntries.flatMap((entry, compactIndex) => entry.answer.id ? [[entry.answer.id, compactIndex] as const] : []),
    );

    const built = buildMemoryCard({
      promptJa: senseDraft.promptJa,
      meaningJa: senseDraft.meaningJa,
      explanation: senseDraft.explanation,
      answers: answerEntries.map(({ answer }) => ({
        displayForm: answer.displayForm,
        citationForm: normalizeEnglishCitationForm(answer.displayForm, answer.citationForm),
        pattern: answer.pattern,
        acceptedVariants: splitList(answer.acceptedVariants),
        orthographicVariants: splitList(answer.orthographicVariants),
        register: answer.register,
        nuance: answer.nuance,
        note: answer.note,
      })),
      kind: input.draft.kind,
      label: validSenses.length === 1 ? input.draft.label : undefined,
      tags: splitList(input.draft.tags),
      examples: senseDraft.examples.map((example) => ({
        english: example.english,
        japanese: example.japanese,
        note: example.note,
        answerIndex: example.answerId
          ? compactIndexById.get(example.answerId)
          : answerEntries.length === 1 ? 0 : undefined,
      })),
      exercises: (senseDraft.exercises ?? []).map((exercise) => ({
        type: exercise.type,
        prompt: exercise.prompt,
        context: exercise.context,
        answerIndex: exercise.answerIndex === undefined
          ? undefined
          : compactIndexByOriginal.get(exercise.answerIndex),
        acceptedAnswerIndexes: (exercise.acceptedAnswerIndexes ?? [])
          .map((index) => compactIndexByOriginal.get(index))
          .filter((index): index is number => index !== undefined),
        requiredTokens: splitList(exercise.requiredTokens),
        forbiddenTokens: splitList(exercise.forbiddenTokens),
        explanation: exercise.explanation,
        hint: exercise.hint,
      })),
      setId: input.setId,
      setOrder: (input.setOrder ?? 0) + cardIndex,
    }, now);

    const item = built.bundle.items[0];
    const sense = built.bundle.senses[0];
    item.tags = splitList(input.draft.tags);
    if (validSenses.length === 1 && input.draft.lemma?.trim()) item.lemma = input.draft.lemma.trim();
    sense.tags = splitList(senseDraft.tags);
    itemIds.push(item.id);

    entities.push({ entityType: 'item', entityId: item.id, value: item, operation: 'create', baseRevision: 0 });
    entities.push({ entityType: 'sense', entityId: sense.id, value: sense, operation: 'create', baseRevision: 0 });
    for (const answer of built.bundle.answers) {
      entities.push({ entityType: 'answer', entityId: answer.id, value: answer, operation: 'create', baseRevision: 0 });
    }
    for (const example of built.bundle.examples) {
      entities.push({ entityType: 'example', entityId: example.id, value: example, operation: 'create', baseRevision: 0 });
    }
    for (const exercise of built.bundle.exercises) {
      entities.push({ entityType: 'exercise', entityId: exercise.id, value: exercise, operation: 'create', baseRevision: 0 });
    }
    if (built.setMember) {
      entities.push({
        entityType: 'set_member',
        entityId: `${built.setMember.setId}:${built.setMember.itemId}`,
        value: built.setMember,
        operation: 'upsert',
      });
    }
  });

  await input.repository.saveEntities(entities);
  return itemIds;
}
