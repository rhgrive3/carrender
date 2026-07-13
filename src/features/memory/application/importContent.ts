import type { ParsedImportRow } from '../domain/importExport';
import { normalizeAnswerText, normalizeSearchText } from '../domain/normalization';
import type { MemoryAnswer, MemoryContentBundle, MemoryExample, MemoryItem, MemorySense, MemorySetMember } from '../domain/types';
import { MEMORY_STORES, type MemoryWritePrecondition } from '../infrastructure/indexedDb';
import { createMemoryId, MemoryRepository } from '../infrastructure/repositories';

export type DuplicateResolution = 'merge' | 'new_sense' | 'separate' | 'replace' | 'skip';

export interface ImportDuplicateCandidate {
  rowIndex: number;
  itemId?: string;
  senseId?: string;
  answerId?: string;
  /** True only when replace can update one unambiguous existing Answer/Sense pair. */
  canReplace: boolean;
  /** True only when merge has one unambiguous existing or same-batch Sense target. */
  canMerge: boolean;
  /** Revisions shown in the preview, used to reject stale commit-time choices. */
  matchedRevisionFingerprint: string;
  /** Earlier row in the same atomic import, before IDs have been allocated. */
  batchSourceRowIndex?: number;
  kinds: Array<'item' | 'sense' | 'answer' | 'orthographic'>;
  suggestedResolution: DuplicateResolution;
}

export function findImportDuplicates(rows: readonly ParsedImportRow[], content: MemoryContentBundle): ImportDuplicateCandidate[] {
  const firstJapaneseRow = new Map<string, number>();
  const firstEnglishRow = new Map<string, number>();
  return rows.map((row, rowIndex) => {
    const english = normalizeAnswerText(row.english);
    const japanese = normalizeSearchText(row.japanese);
    const matchingAnswers = content.answers.filter((value) => !value.deletedAt && [
      value.displayForm,
      value.citationForm,
      ...value.acceptedVariants,
      ...value.orthographicVariants,
    ].some((form) => normalizeAnswerText(form) === english));
    const senseMatchesJapanese = (sense: MemorySense) => normalizeSearchText(sense.promptJa) === japanese
      || normalizeSearchText(sense.meaningJa) === japanese;
    const compatiblePairs = matchingAnswers.flatMap((candidateAnswer) => {
      const candidateSense = content.senses.find((sense) => !sense.deletedAt && sense.id === candidateAnswer.senseId);
      const candidateItem = candidateSense
        ? content.items.find((value) => !value.deletedAt && value.id === candidateSense.itemId)
        : undefined;
      return candidateSense && candidateItem && senseMatchesJapanese(candidateSense)
        ? [{ answer: candidateAnswer, sense: candidateSense, item: candidateItem }]
        : [];
    });
    const replacePair = compatiblePairs.length === 1 ? compatiblePairs[0] : undefined;
    const answer = replacePair?.answer ?? matchingAnswers[0];
    const answerSense = replacePair?.sense ?? (answer
      ? content.senses.find((sense) => !sense.deletedAt && sense.id === answer.senseId)
      : undefined);
    const matchingSenses = content.senses.filter((sense) => !sense.deletedAt && senseMatchesJapanese(sense));
    const mergeSenseCandidates = compatiblePairs.length > 0
      ? [...new Map(compatiblePairs.map((pair) => [pair.sense.id, pair.sense])).values()]
      : matchingSenses;
    const sameSense = mergeSenseCandidates.length === 1 ? mergeSenseCandidates[0] : undefined;
    const item = replacePair?.item ?? (answer
      ? content.items.find((value) => !value.deletedAt && value.id === answerSense?.itemId)
      : sameSense ? content.items.find((value) => !value.deletedAt && value.id === sameSense.itemId)
        : content.items.find((value) => !value.deletedAt
          && (normalizeAnswerText(value.label) === english || normalizeAnswerText(value.lemma ?? '') === english)));
    const kinds: ImportDuplicateCandidate['kinds'] = [];
    if (item) kinds.push('item');
    if (sameSense) kinds.push('sense');
    if (answer) kinds.push(answer.displayForm === row.english ? 'answer' : 'orthographic');
    const earlierAnswerRow = firstEnglishRow.get(english);
    const earlierSenseRow = firstJapaneseRow.get(japanese);
    if (earlierAnswerRow === undefined) firstEnglishRow.set(english, rowIndex);
    if (earlierSenseRow === undefined) firstJapaneseRow.set(japanese, rowIndex);
    const batchSourceRowIndex = earlierAnswerRow ?? earlierSenseRow;
    if (!answer && earlierAnswerRow !== undefined) kinds.push('answer');
    else if (!sameSense && earlierSenseRow !== undefined) kinds.push('sense');
    const canMergeExisting = mergeSenseCandidates.length === 1;
    const canMergeBatch = mergeSenseCandidates.length === 0 && earlierSenseRow !== undefined;
    const canMerge = canMergeExisting || canMergeBatch;
    return {
      rowIndex,
      itemId: item?.id,
      senseId: sameSense?.id ?? answer?.senseId,
      answerId: answer?.id,
      canReplace: compatiblePairs.length === 1,
      canMerge,
      matchedRevisionFingerprint: [item, sameSense, answer]
        .filter((record): record is MemoryItem | MemorySense | MemoryAnswer => Boolean(record))
        .map((record) => `${record.id}:${record.revision}:${record.updatedAt}:${record.deletedAt ?? ''}`)
        .join('|'),
      batchSourceRowIndex,
      kinds,
      suggestedResolution: answer && sameSense?.id === answer.senseId
        ? 'skip'
        : earlierAnswerRow !== undefined
          ? earlierSenseRow === earlierAnswerRow ? 'skip' : 'new_sense'
          : canMerge
            ? 'merge'
            : item ? 'new_sense' : 'separate',
    };
  });
}

function duplicateFingerprint(candidate: ImportDuplicateCandidate): string {
  return JSON.stringify({
    itemId: candidate.itemId ?? null,
    senseId: candidate.senseId ?? null,
    answerId: candidate.answerId ?? null,
    batchSourceRowIndex: candidate.batchSourceRowIndex ?? null,
    kinds: [...candidate.kinds].sort(),
    canReplace: candidate.canReplace,
    canMerge: candidate.canMerge,
    matchedRevisionFingerprint: candidate.matchedRevisionFingerprint,
  });
}

function newItem(
  row: ParsedImportRow,
  now: string,
  source: 'user' | 'import',
): { item: MemoryItem; sense: MemorySense; answer: MemoryAnswer } {
  const itemId = createMemoryId('item');
  const senseId = createMemoryId('sense');
  return {
    item: {
      id: itemId,
      kind: 'expression',
      label: row.english,
      lemma: row.english,
      tags: row.tags,
      source,
      verificationStatus: 'verified',
      createdAt: now,
      updatedAt: now,
      revision: 1,
    },
    sense: {
      id: senseId,
      itemId,
      promptJa: row.japanese,
      meaningJa: row.meaning ?? row.japanese,
      siblingGroupId: createMemoryId('sibling'),
      tags: row.tags,
      source,
      verificationStatus: 'verified',
      createdAt: now,
      updatedAt: now,
      revision: 1,
    },
    answer: {
      id: createMemoryId('answer'),
      senseId,
      displayForm: row.english,
      citationForm: row.english,
      acceptedVariants: [],
      orthographicVariants: [],
      source,
      verificationStatus: 'verified',
      createdAt: now,
      updatedAt: now,
      revision: 1,
    },
  };
}

/** Builds every write first, then commits once so a failed import leaves no partial rows. */
export async function importParsedRows(input: {
  repository: MemoryRepository;
  rows: readonly ParsedImportRow[];
  resolutions: ReadonlyMap<number, DuplicateResolution>;
  setId?: string;
  /** Manual grid entry uses user; file/paste import defaults to import. */
  source?: 'user' | 'import';
  /**
   * Enables commit-time duplicate revalidation. Pass the candidates shown in
   * the preview (an empty array is valid) so a newly-created or changed match
   * cannot be accepted under a stale choice.
   */
  requireExplicitDuplicateResolution?: boolean;
  reviewedDuplicates?: readonly ImportDuplicateCandidate[];
}): Promise<{ imported: number; skipped: number }> {
  const content = await input.repository.loadContent();
  const duplicates = findImportDuplicates(input.rows, content);
  const duplicateByRow = new Map(duplicates.map((duplicate) => [duplicate.rowIndex, duplicate]));
  const source = input.source ?? 'import';
  if (input.requireExplicitDuplicateResolution) {
    const reviewedByRow = new Map((input.reviewedDuplicates ?? []).map((duplicate) => [duplicate.rowIndex, duplicate]));
    for (const duplicate of duplicates.filter((candidate) => candidate.kinds.length > 0)) {
      const reviewed = reviewedByRow.get(duplicate.rowIndex);
      if (!reviewed || duplicateFingerprint(reviewed) !== duplicateFingerprint(duplicate)) {
        throw new Error(`行${input.rows[duplicate.rowIndex]?.sourceLine ?? duplicate.rowIndex + 1}の重複候補が保存前に変わりました。もう一度確認してください`);
      }
      if (!input.resolutions.has(duplicate.rowIndex)) {
        throw new Error(`行${input.rows[duplicate.rowIndex]?.sourceLine ?? duplicate.rowIndex + 1}の重複処理を選択してください`);
      }
    }
    const currentByRow = new Map(duplicates
      .filter((candidate) => candidate.kinds.length > 0)
      .map((candidate) => [candidate.rowIndex, candidate]));
    for (const reviewed of reviewedByRow.values()) {
      const current = currentByRow.get(reviewed.rowIndex);
      if (reviewed.kinds.length > 0 && (!current || duplicateFingerprint(reviewed) !== duplicateFingerprint(current))) {
        throw new Error(`行${input.rows[reviewed.rowIndex]?.sourceLine ?? reviewed.rowIndex + 1}の重複候補が保存前に変わりました。もう一度確認してください`);
      }
    }
  }
  const now = new Date().toISOString();
  const entities: Parameters<MemoryRepository['saveEntities']>[0] = [];
  const sets = await input.repository.listSets();
  if (input.setId && !sets.some((set) => set.id === input.setId)) {
    throw new Error('保存先セットが削除または変更されました。保存先を選び直してください');
  }
  const setByName = new Map(sets.map((set) => [normalizeSearchText(set.name), set.id]));
  const setForRow = (row: ParsedImportRow): string | undefined => {
    if (input.setId) return input.setId;
    if (!row.setName) return undefined;
    const id = setByName.get(normalizeSearchText(row.setName));
    if (!id) throw new Error(`セット「${row.setName}」が見つかりません`);
    return id;
  };
  // Resolve every set before constructing writes so an unknown set can never
  // leave a partially imported transaction.
  const targetSetIds = [...new Set(input.rows.map(setForRow).filter((id): id is string => Boolean(id)))];
  const memberGroups = await Promise.all(targetSetIds.map(async (setId) => [setId, await input.repository.listSetMembers(setId)] as const));
  const nextOrder = new Map(memberGroups.map(([setId, members]) => [setId, members.length]));
  let imported = 0;
  let skipped = 0;
  const newlyAddedToSet = new Set(memberGroups.flatMap(([setId, members]) => members.map((member) => `${setId}\u0000${member.itemId}`)));
  const batchCreated = new Map<number, { itemId: string; senseId: string; answerId: string; siblingGroupId: string }>();

  const addMember = (itemId: string, row: ParsedImportRow) => {
    const setId = setForRow(row);
    if (!setId) return;
    const key = `${setId}\u0000${itemId}`;
    if (newlyAddedToSet.has(key)) return;
    newlyAddedToSet.add(key);
    const order = nextOrder.get(setId) ?? 0;
    nextOrder.set(setId, order + 1);
    const member: MemorySetMember = { setId, itemId, order, createdAt: now };
    entities.push({ entityType: 'set_member', entityId: `${setId}:${itemId}`, value: member, operation: 'upsert' });
  };

  const addExample = (senseId: string, answerId: string | undefined, row: ParsedImportRow) => {
    if (!row.example) return;
    const example: MemoryExample = {
      id: createMemoryId('example'), senseId, answerId,
      english: row.example, source, verificationStatus: 'verified',
      createdAt: now, updatedAt: now, revision: 1,
    };
    entities.push({ entityType: 'example', entityId: example.id, value: example, operation: 'create', baseRevision: 0 });
  };

  input.rows.forEach((row, rowIndex) => {
    const duplicate = duplicateByRow.get(rowIndex);
    const resolution = input.resolutions.get(rowIndex) ?? duplicate?.suggestedResolution ?? 'separate';
    if (resolution === 'skip') {
      skipped += 1;
      const batch = duplicate?.batchSourceRowIndex === undefined ? undefined : batchCreated.get(duplicate.batchSourceRowIndex);
      if (duplicate?.itemId) addMember(duplicate.itemId, row);
      else if (batch) addMember(batch.itemId, row);
      return;
    }

    if (resolution === 'replace') {
      const currentAnswer = duplicate?.answerId
        ? content.answers.find((answer) => !answer.deletedAt && answer.id === duplicate.answerId)
        : undefined;
      const currentSense = currentAnswer
        ? content.senses.find((sense) => !sense.deletedAt && sense.id === currentAnswer.senseId)
        : undefined;
      const currentItem = currentSense
        ? content.items.find((item) => !item.deletedAt && item.id === currentSense.itemId)
        : undefined;
      const compatibleJapanese = currentSense
        ? [currentSense.promptJa, currentSense.meaningJa]
          .some((value) => normalizeSearchText(value) === normalizeSearchText(row.japanese))
        : false;
      if (!duplicate?.canReplace || !currentAnswer || !currentSense || !currentItem || !compatibleJapanese) {
        throw new Error(`行${row.sourceLine}は置換先の意味・英語表現を一意に特定できません。統合、別の意味、または別項目を選んでください`);
      }

      const updatedSense: MemorySense = {
        ...currentSense,
        promptJa: row.japanese,
        meaningJa: row.meaning ?? row.japanese,
        tags: [...row.tags],
        updatedAt: now,
        revision: currentSense.revision + 1,
      };
      const updatedAnswer: MemoryAnswer = {
        ...currentAnswer,
        displayForm: row.english,
        citationForm: row.english,
        updatedAt: now,
        revision: currentAnswer.revision + 1,
      };
      entities.push(
        {
          entityType: 'sense', entityId: currentSense.id, value: updatedSense,
          operation: 'update', baseRevision: currentSense.revision,
        },
        {
          entityType: 'answer', entityId: currentAnswer.id, value: updatedAnswer,
          operation: 'update', baseRevision: currentAnswer.revision,
        },
      );

      if (row.example) {
        const candidates = content.examples.filter((example) => !example.deletedAt
          && example.senseId === currentSense.id && example.answerId === currentAnswer.id);
        const exact = candidates.filter((example) => normalizeSearchText(example.english) === normalizeSearchText(row.example ?? ''));
        const currentExample = exact.length === 1
          ? exact[0]
          : exact.length === 0 && candidates.length === 1 ? candidates[0] : undefined;
        if ((exact.length > 1) || (exact.length === 0 && candidates.length > 1)) {
          throw new Error(`行${row.sourceLine}は置換先の例文を一意に特定できません`);
        }
        if (currentExample) {
          const updatedExample: MemoryExample = {
            ...currentExample,
            english: row.example,
            updatedAt: now,
            revision: currentExample.revision + 1,
          };
          entities.push({
            entityType: 'example', entityId: currentExample.id, value: updatedExample,
            operation: 'update', baseRevision: currentExample.revision,
          });
        } else {
          addExample(currentSense.id, currentAnswer.id, row);
        }
      }
      addMember(currentItem.id, row);
      imported += 1;
      return;
    }

    if (resolution === 'merge' && !duplicate?.canMerge) {
      throw new Error(`行${row.sourceLine}は統合先の意味を一意に特定できません。別項目として保持するか、登録後に編集してください`);
    }

    if (resolution === 'merge' && duplicate?.batchSourceRowIndex !== undefined) {
      const created = batchCreated.get(duplicate.batchSourceRowIndex);
      if (created) {
        const answer: MemoryAnswer = {
          id: createMemoryId('answer'), senseId: created.senseId, displayForm: row.english, citationForm: row.english,
          acceptedVariants: [], orthographicVariants: [], source, verificationStatus: 'verified',
          createdAt: now, updatedAt: now, revision: 1,
        };
        entities.push({ entityType: 'answer', entityId: answer.id, value: answer, operation: 'create', baseRevision: 0 });
        addExample(created.senseId, answer.id, row);
        addMember(created.itemId, row);
        batchCreated.set(rowIndex, { ...created, answerId: answer.id });
        imported += 1;
        return;
      }
    }

    if (resolution === 'merge' && duplicate?.senseId) {
      const existingAnswer = content.answers.find((answer) => answer.senseId === duplicate.senseId
        && normalizeAnswerText(answer.displayForm) === normalizeAnswerText(row.english));
      const sense = content.senses.find((value) => value.id === duplicate.senseId);
      let answerId = existingAnswer?.id;
      if (!existingAnswer && sense) {
        const answer: MemoryAnswer = {
          id: createMemoryId('answer'), senseId: sense.id, displayForm: row.english, citationForm: row.english,
          acceptedVariants: [], orthographicVariants: [], source, verificationStatus: 'verified',
          createdAt: now, updatedAt: now, revision: 1,
        };
        entities.push({ entityType: 'answer', entityId: answer.id, value: answer, operation: 'create', baseRevision: 0 });
        answerId = answer.id;
      }
      if (sense) {
        addMember(sense.itemId, row);
        addExample(sense.id, answerId, row);
      }
      imported += 1;
      return;
    }

    if (resolution === 'new_sense' && duplicate?.itemId) {
      const itemSiblingGroupId = content.senses.find((value) => value.itemId === duplicate.itemId)?.siblingGroupId
        ?? createMemoryId('sibling');
      const sense: MemorySense = {
        id: createMemoryId('sense'), itemId: duplicate.itemId, promptJa: row.japanese,
        meaningJa: row.meaning ?? row.japanese, siblingGroupId: itemSiblingGroupId, tags: row.tags,
        source, verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1,
      };
      const answer: MemoryAnswer = {
        id: createMemoryId('answer'), senseId: sense.id, displayForm: row.english, citationForm: row.english,
        acceptedVariants: [], orthographicVariants: [], source, verificationStatus: 'verified',
        createdAt: now, updatedAt: now, revision: 1,
      };
      entities.push(
        { entityType: 'sense', entityId: sense.id, value: sense, operation: 'create', baseRevision: 0 },
        { entityType: 'answer', entityId: answer.id, value: answer, operation: 'create', baseRevision: 0 },
      );
      addExample(sense.id, answer.id, row);
      addMember(duplicate.itemId, row);
      batchCreated.set(rowIndex, {
        itemId: duplicate.itemId,
        senseId: sense.id,
        answerId: answer.id,
        siblingGroupId: sense.siblingGroupId,
      });
      imported += 1;
      return;
    }

    if (resolution === 'new_sense' && duplicate?.batchSourceRowIndex !== undefined) {
      const created = batchCreated.get(duplicate.batchSourceRowIndex);
      if (created) {
        const sense: MemorySense = {
          id: createMemoryId('sense'), itemId: created.itemId, promptJa: row.japanese,
          meaningJa: row.meaning ?? row.japanese, siblingGroupId: created.siblingGroupId, tags: row.tags,
          source, verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1,
        };
        const answer: MemoryAnswer = {
          id: createMemoryId('answer'), senseId: sense.id, displayForm: row.english, citationForm: row.english,
          acceptedVariants: [], orthographicVariants: [], source, verificationStatus: 'verified',
          createdAt: now, updatedAt: now, revision: 1,
        };
        entities.push(
          { entityType: 'sense', entityId: sense.id, value: sense, operation: 'create', baseRevision: 0 },
          { entityType: 'answer', entityId: answer.id, value: answer, operation: 'create', baseRevision: 0 },
        );
        addExample(sense.id, answer.id, row);
        addMember(created.itemId, row);
        batchCreated.set(rowIndex, {
          itemId: created.itemId,
          senseId: sense.id,
          answerId: answer.id,
          siblingGroupId: created.siblingGroupId,
        });
        imported += 1;
        return;
      }
    }

    const created = newItem(row, now, source);
    entities.push(
      { entityType: 'item', entityId: created.item.id, value: created.item, operation: 'create', baseRevision: 0 },
      { entityType: 'sense', entityId: created.sense.id, value: created.sense, operation: 'create', baseRevision: 0 },
      { entityType: 'answer', entityId: created.answer.id, value: created.answer, operation: 'create', baseRevision: 0 },
    );
    addExample(created.sense.id, created.answer.id, row);
    addMember(created.item.id, row);
    batchCreated.set(rowIndex, {
      itemId: created.item.id,
      senseId: created.sense.id,
      answerId: created.answer.id,
      siblingGroupId: created.sense.siblingGroupId,
    });
    imported += 1;
  });

  if (entities.length > 0) {
    const preconditions = new Map<string, MemoryWritePrecondition>();
    const addPrecondition = (value: MemoryWritePrecondition) => {
      preconditions.set(`${value.store}:${JSON.stringify(value.key)}`, value);
    };
    const currentByType = {
      item: new Map(content.items.map((value) => [value.id, value])),
      sense: new Map(content.senses.map((value) => [value.id, value])),
      answer: new Map(content.answers.map((value) => [value.id, value])),
      example: new Map(content.examples.map((value) => [value.id, value])),
      exercise: new Map(content.exercises.map((value) => [value.id, value])),
    };
    const storeByType = {
      item: MEMORY_STORES.items,
      sense: MEMORY_STORES.senses,
      answer: MEMORY_STORES.answers,
      example: MEMORY_STORES.examples,
      exercise: MEMORY_STORES.exercises,
    } as const;

    // Recheck every record that determined the duplicate preview, even when it
    // is only referenced by a newly-created child and is not itself updated.
    for (const duplicate of duplicates) {
      for (const [entityType, entityId] of [
        ['item', duplicate.itemId],
        ['sense', duplicate.senseId],
        ['answer', duplicate.answerId],
      ] as const) {
        if (!entityId) continue;
        addPrecondition({
          store: storeByType[entityType],
          key: entityId,
          expected: currentByType[entityType].get(entityId),
        });
      }
    }
    for (const setId of targetSetIds) {
      addPrecondition({
        store: MEMORY_STORES.sets,
        key: setId,
        expected: sets.find((set) => set.id === setId),
      });
    }
    for (const entity of entities) {
      if (entity.entityType === 'set_member') {
        const member = entity.value as MemorySetMember;
        const current = memberGroups
          .find(([setId]) => setId === member.setId)?.[1]
          .find((value) => value.itemId === member.itemId);
        addPrecondition({ store: MEMORY_STORES.setMembers, key: [member.setId, member.itemId], expected: current });
        continue;
      }
      if (entity.entityType === 'set' || entity.entityType === 'session') continue;
      addPrecondition({
        store: storeByType[entity.entityType],
        key: entity.entityId,
        expected: entity.operation === 'create' ? undefined : currentByType[entity.entityType].get(entity.entityId),
      });
    }
    await input.repository.saveEntities(entities, [...preconditions.values()]);
  }
  return { imported, skipped };
}
