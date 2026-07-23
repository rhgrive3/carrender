import assert from 'node:assert/strict';
import { saveMemoryItemDraft, type MemoryItemDraft } from '../src/features/memory/application/editContent';
import type { MemoryContentBundle } from '../src/features/memory/domain/types';
import type { MemoryRepository } from '../src/features/memory/infrastructure/repositories';

const now = '2026-07-23T10:50:00.000Z';
const original: MemoryContentBundle = {
  items: [
    { id: 'item-a', kind: 'expression', label: 'answer a', lemma: 'answer a', tags: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 },
    { id: 'item-b', kind: 'expression', label: 'answer b', lemma: 'answer b', tags: [], source: 'ai', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 4 },
  ],
  senses: [
    { id: 'sense-a', itemId: 'item-a', promptJa: '意味A', meaningJa: '意味A', siblingGroupId: 'sibling-a', tags: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 },
    { id: 'sense-b', itemId: 'item-b', promptJa: '意味B', meaningJa: '意味B', siblingGroupId: 'sibling-b', tags: [], source: 'ai', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 4 },
  ],
  answers: [
    { id: 'answer-a', senseId: 'sense-a', displayForm: 'answer a', citationForm: 'answer a', acceptedVariants: [], orthographicVariants: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 },
    { id: 'answer-b', senseId: 'sense-b', displayForm: 'answer b', citationForm: 'answer b', acceptedVariants: [], orthographicVariants: [], source: 'ai', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 4 },
  ],
  examples: [
    { id: 'example-a', senseId: 'sense-a', answerId: 'answer-a', english: 'Example A.', source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 },
    { id: 'example-b', senseId: 'sense-b', answerId: 'answer-b', english: 'Example B.', source: 'ai', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 4 },
  ],
  exercises: [
    { id: 'exercise-a', senseId: 'sense-a', answerId: 'answer-a', type: 'recall', prompt: 'Exercise A', acceptedAnswerIds: ['answer-a'], requiredTokens: [], forbiddenTokens: [], siblingGroupId: 'sibling-a', source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 },
    { id: 'exercise-b', senseId: 'sense-b', answerId: 'answer-b', type: 'recall', prompt: 'Exercise B', acceptedAnswerIds: ['answer-b'], requiredTokens: [], forbiddenTokens: [], siblingGroupId: 'sibling-b', source: 'ai', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 4 },
  ],
};

const validDraft: MemoryItemDraft = {
  id: 'item-a', kind: 'expression', label: 'answer a', lemma: 'answer a',
  senses: [{
    id: 'sense-a', siblingGroupId: 'sibling-a', promptJa: '意味A更新', meaningJa: '意味A更新',
    answers: [{ id: 'answer-a', displayForm: 'answer a updated', citationForm: 'answer a updated' }],
    examples: [{ id: 'example-a', english: 'Example A updated.', answerId: 'answer-a' }],
    exercises: [{ id: 'exercise-a', type: 'recall', prompt: 'Exercise A updated', answerIndex: 0, acceptedAnswerIndexes: [0] }],
  }],
};

let saveCalls = 0;
let saved: Parameters<MemoryRepository['saveEntities']>[0] = [];
const repository = {
  saveEntities: async (entities: Parameters<MemoryRepository['saveEntities']>[0]) => {
    saveCalls += 1;
    saved = entities;
  },
} as unknown as MemoryRepository;

async function rejectsWithoutWrite(draft: MemoryItemDraft, label: string) {
  const before = saveCalls;
  await assert.rejects(
    saveMemoryItemDraft({ repository, original, draft }),
    /保存先が元データと一致しません/,
    label,
  );
  assert.equal(saveCalls, before, `${label}: validation failure must not write entities or pending mutations`);
}

await rejectsWithoutWrite({ ...validDraft, senses: [{ ...validDraft.senses[0], id: 'sense-b' }] }, '別ItemのSense IDを拒否する');
await rejectsWithoutWrite({ ...validDraft, senses: [{ ...validDraft.senses[0], answers: [{ id: 'answer-b', displayForm: 'answer b' }] }] }, '別SenseのAnswer IDを拒否する');
await rejectsWithoutWrite({ ...validDraft, senses: [{ ...validDraft.senses[0], examples: [{ id: 'example-b', english: 'Example B.' }] }] }, '別SenseのExample IDを拒否する');
await rejectsWithoutWrite({ ...validDraft, senses: [{ ...validDraft.senses[0], exercises: [{ id: 'exercise-b', type: 'recall', prompt: 'Exercise B' }] }] }, '別SenseのExercise IDを拒否する');
await rejectsWithoutWrite({ ...validDraft, senses: [{ ...validDraft.senses[0], answers: [{ id: 'missing-answer', displayForm: 'missing' }] }] }, 'originalに存在しない既存風IDを拒否する');

await saveMemoryItemDraft({ repository, original, draft: validDraft });
assert.equal(saveCalls, 1, '正しいscopeのdraftは1 transactionで保存する');
const value = <T>(type: string, id: string) => {
  const entry = saved.find((candidate) => candidate.entityType === type && candidate.entityId === id);
  assert.ok(entry, `${type}:${id} must be saved`);
  return entry.value as T;
};
assert.deepEqual(
  {
    id: value<{ id: string; itemId: string; revision: number; createdAt: string; source: string }>('sense', 'sense-a').id,
    itemId: value<{ itemId: string }>('sense', 'sense-a').itemId,
    revision: value<{ revision: number }>('sense', 'sense-a').revision,
    createdAt: value<{ createdAt: string }>('sense', 'sense-a').createdAt,
    source: value<{ source: string }>('sense', 'sense-a').source,
  },
  { id: 'sense-a', itemId: 'item-a', revision: 2, createdAt: now, source: 'user' },
  '同一scopeではidentity・親・履歴metadataを維持する',
);
assert.equal(value<{ senseId: string }>('answer', 'answer-a').senseId, 'sense-a');
assert.equal(value<{ senseId: string }>('example', 'example-a').senseId, 'sense-a');
assert.equal(value<{ senseId: string }>('exercise', 'exercise-a').senseId, 'sense-a');

console.log('✅ memory draft IDs cannot reparent entities across Item or Sense boundaries');
