import assert from 'node:assert/strict';
import {
  MemoryMutationReferenceError,
  analyzeMemoryMutationReferences,
} from '../src/features/memory/infrastructure/mutationReferenceGuard';
import type {
  MemoryLocalSnapshot,
  MemoryPendingMutation,
} from '../src/features/memory/infrastructure/repositories';

const now = '2026-07-22T00:00:00.000Z';

function mutation(
  mutationId: string,
  entityType: MemoryPendingMutation['entityType'],
  entityId: string,
  payload: Record<string, unknown>,
  localSequence: number,
  operation: MemoryPendingMutation['operation'] = 'create',
): MemoryPendingMutation {
  return {
    mutationId,
    clientId: 'client-1',
    entityType,
    entityId,
    entityKey: `${entityType}:${entityId}`,
    operation,
    baseRevision: operation === 'create' ? 0 : 1,
    payload,
    createdAt: now,
    localSequence,
  };
}

function snapshot(overrides: Partial<MemoryLocalSnapshot> = {}): MemoryLocalSnapshot {
  return {
    items: [], senses: [], answers: [], examples: [], exercises: [],
    sets: [], setMembers: [], stats: [],
    ...overrides,
  };
}

const orphanSense = mutation('sense-orphan', 'sense', 'sense-1', { id: 'sense-1', itemId: 'deleted-item' }, 1);
const independentSet = mutation('set-ok', 'set', 'set-1', { id: 'set-1', name: '独立セット' }, 2);
const direct = analyzeMemoryMutationReferences([orphanSense, independentSet], snapshot());
assert.deepEqual(direct.sendable.map((value) => value.mutationId), ['set-ok'], '独立mutationは先に送信できる');
assert.deepEqual(direct.blocked.map((value) => value.mutationId), ['sense-orphan'], '削除済み親を参照する子を隔離する');
assert.deepEqual(direct.problems[0].missingDependencyKeys, ['item:deleted-item']);

const pendingParent = mutation('item-create', 'item', 'item-1', { id: 'item-1', label: 'word' }, 1);
const pendingChild = mutation('sense-create', 'sense', 'sense-1', { id: 'sense-1', itemId: 'item-1' }, 2);
const sameQueue = analyzeMemoryMutationReferences([pendingChild, pendingParent], snapshot());
assert.equal(sameQueue.blocked.length, 0, '同じqueueで作成される親は欠落扱いにしない');

const existingParent = analyzeMemoryMutationReferences(
  [pendingChild],
  snapshot({ items: [{ id: 'item-1' }] as MemoryLocalSnapshot['items'] }),
);
assert.equal(existingParent.blocked.length, 0, '端末に存在する親への参照は維持する');

const orphanAnswer = mutation('answer-orphan', 'answer', 'answer-1', { id: 'answer-1', senseId: 'sense-1' }, 3);
const transitive = analyzeMemoryMutationReferences([orphanSense, orphanAnswer], snapshot());
assert.deepEqual(
  transitive.blocked.map((value) => value.mutationId),
  ['sense-orphan', 'answer-orphan'],
  '孤児mutationへ依存する下流mutationも隔離する',
);
assert.deepEqual(transitive.problems[1].missingDependencyKeys, ['sense:sense-1']);

const childDelete = mutation(
  'sense-delete',
  'sense',
  'sense-1',
  { id: 'sense-1', itemId: 'deleted-item', deletedAt: now },
  1,
  'delete',
);
assert.equal(
  analyzeMemoryMutationReferences([childDelete], snapshot()).blocked.length,
  0,
  '親が消えた後の子tombstoneは掃除を妨げない',
);

const error = new MemoryMutationReferenceError(direct);
assert.match(error.message, /sense:sense-1/);
assert.match(error.message, /item:deleted-item/);
assert.equal(error.problems.length, 1);

console.log('✅ memory conflict reference revalidation contracts passed');
