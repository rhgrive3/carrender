import type {
  ContentSource,
  MemoryAnswer,
  MemoryContentBundle,
  MemoryExample,
  MemoryExercise,
  MemoryItem,
  MemoryItemKind,
  MemorySense,
  MemorySet,
  MemorySetMember,
  VerificationStatus,
} from '../domain/types';
import { createMemoryId, MemoryRepository } from '../infrastructure/repositories';

export interface CreateMemoryCardInput {
  promptJa: string;
  answers: Array<{
    displayForm: string;
    citationForm?: string;
    pattern?: string;
    acceptedVariants?: string[];
    orthographicVariants?: string[];
    register?: MemoryAnswer['register'];
    nuance?: string;
    note?: string;
  }>;
  kind?: MemoryItemKind;
  label?: string;
  meaningJa?: string;
  explanation?: string;
  tags?: string[];
  examples?: Array<{ english: string; japanese?: string; note?: string; answerIndex?: number }>;
  exercises?: Array<{
    type: MemoryExercise['type'];
    prompt: string;
    context?: string;
    answerIndex?: number;
    acceptedAnswerIndexes?: number[];
    requiredTokens?: string[];
    forbiddenTokens?: string[];
    explanation?: string;
    hint?: string;
  }>;
  setId?: string;
  setOrder?: number;
  source?: ContentSource;
  verificationStatus?: VerificationStatus;
}

function cleanList(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

export function buildMemoryCard(input: CreateMemoryCardInput, now = new Date().toISOString()): {
  bundle: MemoryContentBundle;
  setMember?: MemorySetMember;
} {
  const promptJa = input.promptJa.trim();
  const validAnswers = input.answers.filter((answer) => answer.displayForm.trim());
  if (!promptJa) throw new Error('日本語を入力してください');
  if (validAnswers.length === 0) throw new Error('英語表現を1つ以上入力してください');

  const source = input.source ?? 'user';
  const verificationStatus = input.verificationStatus ?? (source === 'ai' ? 'unverified_ai' : 'verified');
  const itemId = createMemoryId('item');
  const senseId = createMemoryId('sense');
  const siblingGroupId = createMemoryId('sibling');
  const tags = cleanList(input.tags);
  const item: MemoryItem = {
    id: itemId,
    kind: input.kind ?? 'expression',
    label: input.label?.trim() || validAnswers[0].citationForm?.trim() || validAnswers[0].displayForm.trim(),
    lemma: validAnswers[0].citationForm?.trim() || validAnswers[0].displayForm.trim(),
    tags,
    source,
    verificationStatus,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
  const sense: MemorySense = {
    id: senseId,
    itemId,
    promptJa,
    meaningJa: input.meaningJa?.trim() || promptJa,
    explanation: input.explanation?.trim() || undefined,
    siblingGroupId,
    tags,
    source,
    verificationStatus,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
  const answers: MemoryAnswer[] = validAnswers.map((answer) => ({
    id: createMemoryId('answer'),
    senseId,
    displayForm: answer.displayForm.trim(),
    citationForm: answer.citationForm?.trim() || answer.displayForm.trim(),
    pattern: answer.pattern?.trim() || undefined,
    acceptedVariants: cleanList(answer.acceptedVariants),
    orthographicVariants: cleanList(answer.orthographicVariants),
    register: answer.register,
    nuance: answer.nuance?.trim() || undefined,
    note: answer.note?.trim() || undefined,
    source,
    verificationStatus,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  }));
  const examples: MemoryExample[] = (input.examples ?? [])
    .filter((example) => example.english.trim())
    .map((example) => ({
      id: createMemoryId('example'),
      senseId,
      answerId: example.answerIndex === undefined ? undefined : answers[example.answerIndex]?.id,
      english: example.english.trim(),
      japanese: example.japanese?.trim() || undefined,
      note: example.note?.trim() || undefined,
      source,
      verificationStatus,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    }));
  const exercises: MemoryExercise[] = (input.exercises ?? []).map((exercise) => ({
    id: createMemoryId('exercise'),
    senseId,
    answerId: exercise.answerIndex === undefined ? undefined : answers[exercise.answerIndex]?.id,
    type: exercise.type,
    prompt: exercise.prompt.trim(),
    context: exercise.context?.trim() || undefined,
    acceptedAnswerIds: (exercise.acceptedAnswerIndexes ?? [])
      .map((index) => answers[index]?.id)
      .filter((id): id is string => Boolean(id)),
    requiredTokens: cleanList(exercise.requiredTokens),
    forbiddenTokens: cleanList(exercise.forbiddenTokens),
    explanation: exercise.explanation?.trim() || undefined,
    hint: exercise.hint?.trim() || undefined,
    siblingGroupId,
    source,
    verificationStatus,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  }));

  return {
    bundle: { items: [item], senses: [sense], answers, examples, exercises },
    setMember: input.setId
      ? { setId: input.setId, itemId, order: input.setOrder ?? 0, createdAt: now }
      : undefined,
  };
}

export async function createMemoryCard(repository: MemoryRepository, input: CreateMemoryCardInput): Promise<MemoryItem> {
  const built = buildMemoryCard(input);
  await repository.saveContentBundle(built.bundle, built.setMember ? [built.setMember] : []);
  return built.bundle.items[0];
}

export async function createMemorySet(
  repository: MemoryRepository,
  input: { name: string; description?: string; tags?: string[] },
): Promise<MemorySet> {
  const name = input.name.trim();
  if (!name) throw new Error('セット名を入力してください');
  const now = new Date().toISOString();
  const set: MemorySet = {
    id: createMemoryId('set'),
    name,
    description: input.description?.trim() || undefined,
    tags: cleanList(input.tags),
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
  await repository.createSet(set);
  return set;
}

export async function updateMemorySet(
  repository: MemoryRepository,
  set: MemorySet,
  input: { name: string; description?: string; tags?: string[] },
): Promise<MemorySet> {
  const name = input.name.trim();
  if (!name) throw new Error('セット名を入力してください');
  const updated: MemorySet = {
    ...set,
    name,
    description: input.description?.trim() || undefined,
    tags: cleanList(input.tags),
    updatedAt: new Date().toISOString(),
    revision: set.revision + 1,
  };
  await repository.saveEntities([{
    entityType: 'set', entityId: set.id, value: updated, operation: 'update', baseRevision: set.revision,
  }]);
  return updated;
}

/** Deletes only the set reference container; Item content and stats remain intact. */
export async function deleteMemorySet(repository: MemoryRepository, set: MemorySet): Promise<void> {
  const now = new Date().toISOString();
  const members = await repository.listSetMembers(set.id);
  await repository.saveEntities([
    {
      entityType: 'set', entityId: set.id,
      value: { ...set, revision: set.revision + 1, updatedAt: now, deletedAt: now },
      operation: 'delete', baseRevision: set.revision,
    },
    ...members.map((member) => ({
      entityType: 'set_member' as const,
      entityId: `${member.setId}:${member.itemId}`,
      value: { ...member, deletedAt: now },
      operation: 'upsert' as const,
    })),
  ]);
}

export async function addAnswerToSense(
  repository: MemoryRepository,
  senseId: string,
  displayForm: string,
  options: Partial<Pick<MemoryAnswer, 'citationForm' | 'pattern' | 'acceptedVariants' | 'orthographicVariants' | 'register' | 'nuance' | 'note'>> = {},
): Promise<MemoryAnswer> {
  const value = displayForm.trim();
  if (!value) throw new Error('英語表現を入力してください');
  const now = new Date().toISOString();
  const answer: MemoryAnswer = {
    id: createMemoryId('answer'),
    senseId,
    displayForm: value,
    citationForm: options.citationForm?.trim() || value,
    pattern: options.pattern?.trim() || undefined,
    acceptedVariants: cleanList(options.acceptedVariants),
    orthographicVariants: cleanList(options.orthographicVariants),
    register: options.register,
    nuance: options.nuance?.trim() || undefined,
    note: options.note?.trim() || undefined,
    source: 'user',
    verificationStatus: 'verified',
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
  await repository.saveContentBundle({ items: [], senses: [], answers: [answer], examples: [], exercises: [] });
  return answer;
}

export async function addItemsToSet(
  repository: MemoryRepository,
  setId: string,
  itemIds: string[],
): Promise<void> {
  const existing = await repository.listSetMembers(setId);
  const known = new Set(existing.map((member) => member.itemId));
  const now = new Date().toISOString();
  const additions = [...new Set(itemIds)]
    .filter((itemId) => !known.has(itemId))
    .map((itemId, index): MemorySetMember => ({
      setId,
      itemId,
      order: existing.length + index,
      createdAt: now,
    }));
  if (additions.length === 0) return;
  await repository.saveContentBundle(
    { items: [], senses: [], answers: [], examples: [], exercises: [] },
    additions,
  );
}

/** Marks an Item and every unverified descendant as explicitly user-reviewed. */
export async function verifyMemoryItem(repository: MemoryRepository, itemId: string): Promise<number> {
  const content = await repository.loadContent();
  const item = content.items.find((record) => record.id === itemId);
  if (!item) throw new Error('確認する暗記項目が見つかりません');
  const senseIds = new Set(content.senses.filter((sense) => sense.itemId === itemId).map((sense) => sense.id));
  const candidates: Array<{
    entityType: 'item' | 'sense' | 'answer' | 'example' | 'exercise';
    record: MemoryItem | MemorySense | MemoryAnswer | MemoryExample | MemoryExercise;
  }> = [
    { entityType: 'item', record: item },
    ...content.senses.filter((record) => senseIds.has(record.id)).map((record) => ({ entityType: 'sense' as const, record })),
    ...content.answers.filter((record) => senseIds.has(record.senseId)).map((record) => ({ entityType: 'answer' as const, record })),
    ...content.examples.filter((record) => senseIds.has(record.senseId)).map((record) => ({ entityType: 'example' as const, record })),
    ...content.exercises.filter((record) => senseIds.has(record.senseId)).map((record) => ({ entityType: 'exercise' as const, record })),
  ];
  const now = new Date().toISOString();
  const entities: Parameters<MemoryRepository['saveEntities']>[0] = candidates
    .filter(({ record }) => record.verificationStatus === 'unverified_ai')
    .map(({ entityType, record }) => ({
      entityType,
      entityId: record.id,
      value: { ...record, verificationStatus: 'verified' as const, revision: record.revision + 1, updatedAt: now },
      operation: 'update' as const,
      baseRevision: record.revision,
    }));
  if (entities.length > 0) await repository.saveEntities(entities);
  return entities.length;
}
