import assert from 'node:assert/strict';
import { analyzeMutationDependencies } from '../src/features/memory/infrastructure/mutationDependency';
import type { MemoryPendingMutation } from '../src/features/memory/infrastructure/repositories';

function mutation(
  mutationId: string,
  entityType: MemoryPendingMutation['entityType'],
  entityId: string,
  operation: MemoryPendingMutation['operation'],
  payload: Record<string, unknown>,
  localSequence: number,
): MemoryPendingMutation {
  return {
    mutationId,
    clientId: 'client_test',
    entityType,
    entityId,
    entityKey: `${entityType}:${entityId}`,
    operation,
    payload,
    createdAt: `2026-07-22T00:00:0${localSequence}.000Z`,
    localSequence,
  };
}

const itemDelete = mutation('item-delete', 'item', 'item-1', 'delete', { id: 'item-1', deletedAt: '2026-07-22T00:00:00.000Z' }, 1);
const itemCreate = mutation('item-create', 'item', 'item-1', 'create', { id: 'item-1' }, 2);
const senseCreate = mutation('sense-create', 'sense', 'sense-1', 'create', { id: 'sense-1', itemId: 'item-1' }, 3);
const senseDelete = mutation('sense-delete', 'sense', 'sense-1', 'delete', { id: 'sense-1', itemId: 'item-1', deletedAt: '2026-07-22T00:00:04.000Z' }, 4);
const independentSet = mutation('set-create', 'set', 'set-1', 'create', { id: 'set-1' }, 5);

const cyclic = analyzeMutationDependencies([
  itemDelete,
  itemCreate,
  senseCreate,
  senseDelete,
  independentSet,
]);
assert.deepEqual([...cyclic.safeMutationIds], ['set-create']);
assert.deepEqual([...cyclic.blockedMutationIds].sort(), [
  'item-create',
  'item-delete',
  'sense-create',
  'sense-delete',
]);
assert.deepEqual(cyclic.blockedEntityKeys, ['item:item-1', 'sense:sense-1']);

const normal = analyzeMutationDependencies([
  mutation('normal-item', 'item', 'item-2', 'create', { id: 'item-2' }, 1),
  mutation('normal-sense', 'sense', 'sense-2', 'create', { id: 'sense-2', itemId: 'item-2' }, 2),
  mutation('normal-answer', 'answer', 'answer-2', 'create', { id: 'answer-2', senseId: 'sense-2' }, 3),
]);
assert.equal(normal.blockedMutationIds.size, 0);
assert.deepEqual([...normal.safeMutationIds], ['normal-item', 'normal-sense', 'normal-answer']);

console.log('memory mutation cycle tests passed');
