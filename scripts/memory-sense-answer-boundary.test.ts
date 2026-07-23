import assert from 'node:assert/strict';
import { saveMemoryItemDraft, type MemoryItemDraft } from '../src/features/memory/application/editContent';
import type { MemoryContentBundle } from '../src/features/memory/domain/types';
import type { MemoryRepository } from '../src/features/memory/infrastructure/repositories';

const now = '2026-07-23T09:30:00.000Z';
const original: MemoryContentBundle = {
  items: [{ id: 'item-1', kind: 'expression', label: 'answer a', lemma: 'answer a', tags: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 }],
  senses: [
    { id: 'sense-a', itemId: 'item-1', promptJa: '意味A', meaningJa: '意味A', siblingGroupId: 'sibling-1', tags: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 },
    { id: 'sense-b', itemId: 'item-1', promptJa: '意味B', meaningJa: '意味B', siblingGroupId: 'sibling-1', tags: [], source: 'user', verificationStatus: 'verified', createdAt: '2026-07-23T09:31:00.000Z', updatedAt: now, revision: 1 },
  ],
  answers: [
    { id: 'answer-a', senseId: 'sense-a', displayForm: 'answer a', citationForm: 'answer a', acceptedVariants: [], orthographicVariants: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 },
    { id: 'answer-b', senseId: 'sense-b', displayForm: 'answer b', citationForm: 'answer b', acceptedVariants: [], orthographicVariants: [], source: 'user', verificationStatus: 'verified', createdAt: '2026-07-23T09:31:00.000Z', updatedAt: now, revision: 1 },
  ],
  examples: [
    { id: 'example-cross', senseId: 'sense-b', answerId: 'answer-a', english: 'Cross-sense example.', japanese: '別の意味を参照する例文。', source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 },
    { id: 'example-valid', senseId: 'sense-b', answerId: 'answer-b', english: 'Valid example.', japanese: '正しい例文。', source: 'user', verificationStatus: 'verified', createdAt: '2026-07-23T09:31:00.000Z', updatedAt: now, revision: 1 },
  ],
  exercises: [
    { id: 'exercise-cross', senseId: 'sense-b', answerId: 'answer-a', type: 'recall', prompt: 'Cross-sense exercise', acceptedAnswerIds: ['answer-a', 'answer-b'], requiredTokens: [], forbiddenTokens: [], siblingGroupId: 'sibling-1', source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 },
    { id: 'exercise-valid', senseId: 'sense-b', answerId: 'answer-b', type: 'recall', prompt: 'Valid exercise', acceptedAnswerIds: ['answer-b'], requiredTokens: [], forbiddenTokens: [], siblingGroupId: 'sibling-1', source: 'user', verificationStatus: 'verified', createdAt: '2026-07-23T09:31:00.000Z', updatedAt: now, revision: 1 },
  ],
};

const draft: MemoryItemDraft = {
  id: 'item-1', kind: 'expression', label: 'answer a', lemma: 'answer a',
  senses: [
    {
      id: 'sense-a', siblingGroupId: 'sibling-1', promptJa: '意味A', meaningJa: '意味A',
      answers: [{ id: 'answer-a', displayForm: 'answer a', citationForm: 'answer a' }],
      examples: [], exercises: [],
    },
    {
      id: 'sense-b', siblingGroupId: 'sibling-1', promptJa: '意味B', meaningJa: '意味B',
      answers: [{ id: 'answer-b', displayForm: 'answer b', citationForm: 'answer b' }],
      examples: [
        { id: 'example-cross', english: 'Cross-sense example.', japanese: '別の意味を参照する例文。', answerId: 'answer-a' },
        { id: 'example-valid', english: 'Valid example.', japanese: '正しい例文。', answerId: 'answer-b' },
      ],
      exercises: [
        { id: 'exercise-cross', type: 'recall', prompt: 'Cross-sense exercise', answerIndex: 0, acceptedAnswerIndexes: [0] },
        { id: 'exercise-valid', type: 'recall', prompt: 'Valid exercise', answerIndex: 0, acceptedAnswerIndexes: [0] },
      ],
    },
  ],
};

let saved: Parameters<MemoryRepository['saveEntities']>[0] = [];
const repository = {
  saveEntities: async (entities: Parameters<MemoryRepository['saveEntities']>[0]) => { saved = entities; },
} as unknown as MemoryRepository;

await saveMemoryItemDraft({ repository, original, draft });

const savedValue = <T>(entityType: string, entityId: string): T => {
  const entry = saved.find((candidate) => candidate.entityType === entityType && candidate.entityId === entityId);
  assert.ok(entry, `${entityType}:${entityId} must be saved`);
  return entry.value as T;
};

assert.equal(savedValue<{ answerId?: string }>('example', 'example-cross').answerId, undefined, '別SenseのAnswer参照を例文から解除する');
assert.equal(savedValue<{ answerId?: string }>('example', 'example-valid').answerId, 'answer-b', '同じSenseの例文参照は維持する');

const crossExercise = savedValue<{ answerId?: string; acceptedAnswerIds: string[] }>('exercise', 'exercise-cross');
assert.equal(crossExercise.answerId, undefined, '別Senseの主Answer参照を問題から解除する');
assert.deepEqual(crossExercise.acceptedAnswerIds, ['answer-b'], '許容回答から別SenseのIDだけを除外する');

const validExercise = savedValue<{ answerId?: string; acceptedAnswerIds: string[] }>('exercise', 'exercise-valid');
assert.equal(validExercise.answerId, 'answer-b', '同じSenseの主Answer参照は維持する');
assert.deepEqual(validExercise.acceptedAnswerIds, ['answer-b']);

saved = [];
await saveMemoryItemDraft({ repository, original, draft: { ...draft, senses: [...draft.senses].reverse() } });
assert.equal(savedValue<{ answerId?: string }>('example', 'example-cross').answerId, undefined, 'Sense処理順を変えても別Sense参照を復活させない');
assert.equal(savedValue<{ answerId?: string }>('exercise', 'exercise-cross').answerId, undefined);

console.log('✅ Example and Exercise Answer references stay within their own Sense');
