import assert from 'node:assert/strict';
import { saveMemoryItemDraft, type MemoryItemDraft } from '../src/features/memory/application/editContent';
import type { MemoryContentBundle } from '../src/features/memory/domain/types';
import type { MemoryRepository } from '../src/features/memory/infrastructure/repositories';

const now = '2026-07-23T08:30:00.000Z';
const original: MemoryContentBundle = {
  items: [{ id: 'item-1', kind: 'expression', label: 'answer a', lemma: 'answer a', tags: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 }],
  senses: [{ id: 'sense-1', itemId: 'item-1', promptJa: '意味', meaningJa: '意味', siblingGroupId: 'sibling-1', tags: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 }],
  answers: [
    { id: 'answer-a', senseId: 'sense-1', displayForm: 'answer a', citationForm: 'answer a', acceptedVariants: [], orthographicVariants: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 },
    { id: 'answer-b', senseId: 'sense-1', displayForm: 'answer b', citationForm: 'answer b', acceptedVariants: [], orthographicVariants: [], source: 'user', verificationStatus: 'verified', createdAt: '2026-07-23T08:31:00.000Z', updatedAt: now, revision: 1 },
  ],
  examples: [
    { id: 'example-a', senseId: 'sense-1', answerId: 'answer-a', english: 'Example for answer A.', japanese: 'A用の例文。', source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 },
    { id: 'example-b', senseId: 'sense-1', answerId: 'answer-b', english: 'Example for answer B.', japanese: 'B用の例文。', source: 'user', verificationStatus: 'verified', createdAt: '2026-07-23T08:31:00.000Z', updatedAt: now, revision: 1 },
  ],
  exercises: [],
};

let saved: Parameters<MemoryRepository['saveEntities']>[0] = [];
const repository = { saveEntities: async (entities: Parameters<MemoryRepository['saveEntities']>[0]) => { saved = entities; } } as unknown as MemoryRepository;
const value = (id: string) => {
  const entry = saved.find((candidate) => candidate.entityType === 'example' && candidate.entityId === id);
  assert.ok(entry);
  return entry.value as { answerId?: string };
};

const draft: MemoryItemDraft = {
  id: 'item-1', kind: 'expression', label: 'answer a', lemma: 'answer a',
  senses: [{
    id: 'sense-1', siblingGroupId: 'sibling-1', promptJa: '意味', meaningJa: '意味',
    answers: [{ id: 'answer-b', displayForm: 'answer b', citationForm: 'answer b' }],
    examples: [
      { id: 'example-a', english: 'Example for answer A.', japanese: 'A用の例文。' },
      { id: 'example-b', english: 'Example for answer B.', japanese: 'B用の例文。', answerId: 'answer-b' },
      { english: 'A new example.', japanese: '新しい例文。' },
    ],
    exercises: [],
  }],
};

await saveMemoryItemDraft({ repository, original, draft });
assert.equal(value('example-a').answerId, undefined);
assert.equal(value('example-b').answerId, 'answer-b');
const created = saved.find((candidate) => candidate.entityType === 'example' && !['example-a', 'example-b'].includes(candidate.entityId));
assert.ok(created);
assert.equal((created.value as { answerId?: string }).answerId, 'answer-b');

console.log('✅ example Answer references remain ID-based');
