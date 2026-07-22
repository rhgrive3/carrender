import assert from 'node:assert/strict';
import { splitMemoryItemIntoCards } from '../src/features/memory/application/splitMemoryItemCards';
import type { MemoryLocalSnapshot, MemoryRepository } from '../src/features/memory/infrastructure/repositories';
import type {
  MemoryAnswer,
  MemoryExample,
  MemoryExercise,
  MemoryItem,
  MemorySense,
  MemorySetMember,
} from '../src/features/memory/domain/types';

const now = '2026-07-22T00:00:00.000Z';
const item: MemoryItem = {
  id: 'item-old', source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now,
  revision: 3, kind: 'expression', label: 'immaterial', lemma: 'immaterial', tags: [],
};
const senses: MemorySense[] = [
  { id: 'sense-a', itemId: item.id, promptJa: '実体のない', meaningJa: '実体のない', siblingGroupId: 'legacy-group', tags: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 2 },
  { id: 'sense-b', itemId: item.id, promptJa: '現時点では', meaningJa: '現時点では', siblingGroupId: 'legacy-group', tags: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 2 },
  { id: 'sense-c', itemId: item.id, promptJa: '贅沢な', meaningJa: '贅沢な', siblingGroupId: 'legacy-group', tags: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 2 },
];
const answers: MemoryAnswer[] = [
  { id: 'answer-a', senseId: 'sense-a', displayForm: 'immaterial', citationForm: 'immaterial', acceptedVariants: [], orthographicVariants: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 },
  { id: 'answer-b', senseId: 'sense-b', displayForm: 'so far', citationForm: 'so far', acceptedVariants: [], orthographicVariants: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 },
  { id: 'answer-c', senseId: 'sense-c', displayForm: 'luxury', citationForm: 'luxury', acceptedVariants: [], orthographicVariants: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 },
];
const examples: MemoryExample[] = [
  { id: 'example-b', senseId: 'sense-b', answerId: 'answer-b', english: 'So far, it has worked.', japanese: '現時点ではうまくいっている。', source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 },
];
const exercises: MemoryExercise[] = [
  { id: 'exercise-b', senseId: 'sense-b', answerId: 'answer-b', type: 'flashcard', prompt: '現時点では', acceptedAnswerIds: ['answer-b'], siblingGroupId: 'legacy-group', source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 4 },
];
const setMembers: MemorySetMember[] = [
  { setId: 'set-a', itemId: 'before', order: 0, createdAt: now },
  { setId: 'set-a', itemId: item.id, order: 1, createdAt: now },
  { setId: 'set-a', itemId: 'after', order: 2, createdAt: now },
  { setId: 'set-b', itemId: item.id, order: 7, createdAt: now },
];
const snapshot = {
  items: [item], senses, answers, examples, exercises, sets: [], setMembers, stats: [],
} as unknown as MemoryLocalSnapshot;

let saveCalls = 0;
let saved: Parameters<MemoryRepository['saveEntities']>[0] = [];
const repository = {
  loadSnapshot: async () => snapshot,
  getActiveSession: async () => undefined,
  saveEntities: async (entities: Parameters<MemoryRepository['saveEntities']>[0]) => {
    saveCalls += 1;
    saved = entities;
  },
} as unknown as MemoryRepository;

const result = await splitMemoryItemIntoCards(repository, item.id);
assert.equal(saveCalls, 1, '全分離を1回のIndexedDB transactionへまとめる');
assert.equal(result.cardCount, 3);
assert.equal(result.itemIds.length, 3);
assert.equal(new Set(result.itemIds).size, 3);
assert.equal(result.itemIds[0], item.id, '最初のカードは元Item IDを維持する');

const itemWrites = saved.filter((entry) => entry.entityType === 'item');
assert.equal(itemWrites.length, 3);
assert.deepEqual(itemWrites.map((entry) => (entry.value as MemoryItem).label), ['immaterial', 'so far', 'luxury']);
assert.deepEqual(itemWrites.map((entry) => entry.operation), ['update', 'create', 'create']);

const senseWrites = saved.filter((entry) => entry.entityType === 'sense').map((entry) => entry.value as MemorySense);
assert.deepEqual(senseWrites.map((sense) => sense.id), ['sense-a', 'sense-b', 'sense-c'], '既存Sense IDを維持する');
assert.deepEqual(senseWrites.map((sense) => sense.itemId), result.itemIds);
assert.deepEqual(senseWrites.map((sense) => sense.siblingGroupId), result.itemIds.map((id) => `item:${id}`));

assert.equal(saved.some((entry) => entry.entityType === 'answer'), false, 'Answer IDと参照を作り直さない');
assert.equal(saved.some((entry) => entry.entityType === 'example'), false, 'Example IDと参照を作り直さない');
const exerciseWrite = saved.find((entry) => entry.entityType === 'exercise');
assert.equal((exerciseWrite?.value as MemoryExercise).id, 'exercise-b');
assert.equal((exerciseWrite?.value as MemoryExercise).siblingGroupId, `item:${result.itemIds[1]}`);

const membersA = saved
  .filter((entry) => entry.entityType === 'set_member' && (entry.value as MemorySetMember).setId === 'set-a')
  .map((entry) => entry.value as MemorySetMember)
  .sort((left, right) => left.order - right.order);
assert.deepEqual(membersA.map((member) => member.itemId), ['before', ...result.itemIds, 'after']);
assert.deepEqual(membersA.map((member) => member.order), [0, 1, 2, 3, 4]);
const membersB = saved
  .filter((entry) => entry.entityType === 'set_member' && (entry.value as MemorySetMember).setId === 'set-b')
  .map((entry) => entry.value as MemorySetMember)
  .sort((left, right) => left.order - right.order);
assert.deepEqual(membersB.map((member) => member.itemId), result.itemIds, '元Itemが属する全Setへ分離カードを追加する');

let blockedSaveCalls = 0;
const activeRepository = {
  loadSnapshot: async () => snapshot,
  getActiveSession: async () => ({ selectedSetIds: ['set-a'] }),
  saveEntities: async () => { blockedSaveCalls += 1; },
} as unknown as MemoryRepository;
await assert.rejects(
  () => splitMemoryItemIntoCards(activeRepository, item.id),
  /暗記学習が進行中/,
  '対象Setの進行中sessionがある場合は古いqueueを壊さない',
);
assert.equal(blockedSaveCalls, 0);

console.log('✅ grouped memory item split contracts passed');
