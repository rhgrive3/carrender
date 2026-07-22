import assert from 'node:assert/strict';
import {
  MemoryMutationDependencyCycleError,
  analyzeMemoryMutationDependencies,
} from '../src/features/memory/infrastructure/mutationDependencyGuard';
import {
  MemoryRepository,
  type MemoryEntityType,
  type MemoryMutationOperation,
  type MemoryPendingMutation,
} from '../src/features/memory/infrastructure/repositories';
import { ValidatedMemoryRepository } from '../src/features/memory/infrastructure/validatedRepository';

const CREATED_AT = '2026-01-01T00:00:00.000Z';

function mutation(
  mutationId: string,
  entityType: MemoryEntityType,
  entityId: string,
  operation: MemoryMutationOperation,
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
    createdAt: CREATED_AT,
    localSequence,
  };
}

function dependencyOrderOverridesLocalSequence(): void {
  const analysis = analyzeMemoryMutationDependencies([
    mutation('sense', 'sense', 'sense_1', 'create', { id: 'sense_1', itemId: 'item_1' }, 1),
    mutation('answer', 'answer', 'answer_1', 'create', { id: 'answer_1', senseId: 'sense_1' }, 2),
    mutation('item', 'item', 'item_1', 'create', { id: 'item_1' }, 3),
  ]);

  assert.deepEqual(
    analysis.sendable.map((value) => value.mutationId),
    ['item', 'sense', 'answer'],
    'creates must remain parent-first even when their local sequence is reversed',
  );
  assert.equal(analysis.blocked.length, 0);
  assert.equal(analysis.cyclePath.length, 0);
}

function tombstonesRemainChildFirst(): void {
  const analysis = analyzeMemoryMutationDependencies([
    mutation('item-delete', 'item', 'item_1', 'delete', { id: 'item_1', deletedAt: CREATED_AT }, 1),
    mutation(
      'sense-delete',
      'sense',
      'sense_1',
      'delete',
      { id: 'sense_1', itemId: 'item_1', deletedAt: CREATED_AT },
      2,
    ),
  ]);

  assert.deepEqual(
    analysis.sendable.map((value) => value.mutationId),
    ['sense-delete', 'item-delete'],
    'tombstones must remain child-first',
  );
}

function cycleFixture(): MemoryPendingMutation[] {
  return [
    mutation('independent-set', 'set', 'set_1', 'create', { id: 'set_1' }, 0),
    mutation('item-delete', 'item', 'item_1', 'delete', { id: 'item_1', deletedAt: CREATED_AT }, 1),
    mutation('item-create', 'item', 'item_1', 'create', { id: 'item_1' }, 2),
    mutation('sense-create', 'sense', 'sense_1', 'create', { id: 'sense_1', itemId: 'item_1' }, 3),
    mutation(
      'sense-delete',
      'sense',
      'sense_1',
      'delete',
      { id: 'sense_1', itemId: 'item_1', deletedAt: CREATED_AT },
      4,
    ),
    mutation('dependent-answer', 'answer', 'answer_1', 'create', { id: 'answer_1', senseId: 'sense_1' }, 5),
  ];
}

function cycleAndDescendantsAreIsolated(): void {
  const analysis = analyzeMemoryMutationDependencies(cycleFixture());

  assert.deepEqual(
    analysis.sendable.map((value) => value.mutationId),
    ['independent-set'],
    'an independent DAG component should still be drainable',
  );
  assert.deepEqual(
    analysis.blocked.map((value) => value.mutationId),
    ['item-delete', 'item-create', 'sense-create', 'sense-delete', 'dependent-answer'],
    'the cycle and every dependent descendant must stay queued',
  );
  assert.deepEqual(
    analysis.cyclePath.map((value) => value.mutationId),
    ['item-delete', 'item-create', 'sense-create', 'sense-delete'],
    'diagnostics should retain one concrete cycle path',
  );

  const error = new MemoryMutationDependencyCycleError(analysis);
  assert.match(error.message, /item:item_1/);
  assert.match(error.message, /sense:sense_1/);
  assert.deepEqual(error.entityKeys, ['item:item_1', 'sense:sense_1', 'answer:answer_1']);
  assert.deepEqual(error.cycleEntityKeys, ['item:item_1', 'sense:sense_1']);
}

async function validatedRepositoryDrainsSafeRowsBeforeFailing(): Promise<void> {
  const prototype = MemoryRepository.prototype as {
    syncablePendingMutations(limit?: number): Promise<MemoryPendingMutation[]>;
  };
  const original = prototype.syncablePendingMutations;
  const repository = new ValidatedMemoryRepository('mutation-cycle-regression');

  try {
    prototype.syncablePendingMutations = async () => cycleFixture();
    assert.deepEqual(
      (await repository.syncablePendingMutations(100)).map((value) => value.mutationId),
      ['independent-set'],
      'production repository should send independent rows first',
    );

    prototype.syncablePendingMutations = async () => cycleFixture().filter(
      (value) => value.mutationId !== 'independent-set',
    );
    await assert.rejects(
      repository.syncablePendingMutations(100),
      (error: unknown) => {
        assert.ok(error instanceof MemoryMutationDependencyCycleError);
        assert.deepEqual(error.mutationIds, [
          'item-delete',
          'item-create',
          'sense-create',
          'sense-delete',
          'dependent-answer',
        ]);
        return true;
      },
    );
  } finally {
    prototype.syncablePendingMutations = original;
  }
}

dependencyOrderOverridesLocalSequence();
tombstonesRemainChildFirst();
cycleAndDescendantsAreIsolated();
await validatedRepositoryDrainsSafeRowsBeforeFailing();
console.log('memory mutation dependency cycle tests passed');
