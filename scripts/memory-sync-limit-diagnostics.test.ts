import assert from 'node:assert/strict';
import type { MemorySyncResponse } from '../src/features/memory/infrastructure/api';
import type {
  LocalMemoryAttempt,
  MemoryPendingMutation,
  MemoryRepository,
  MemorySyncCommit,
} from '../src/features/memory/infrastructure/repositories';
import {
  MEMORY_INITIAL_PULL_ROUNDS,
  MEMORY_MUTATION_UPLOAD_LIMIT,
  flushMemorySync,
  syncMemory,
} from '../src/features/memory/infrastructure/syncEngine';

const now = '2026-07-22T00:00:00.000Z';

function mutation(index: number): MemoryPendingMutation {
  return {
    mutationId: `mutation-${index}`,
    clientId: 'client-1',
    entityType: 'item',
    entityId: `item-${index}`,
    entityKey: `item:item-${index}`,
    operation: 'create',
    baseRevision: 0,
    payload: { id: `item-${index}`, label: `item ${index}` },
    createdAt: now,
    localSequence: index + 1,
  };
}

class DiagnosticRepository {
  commits: MemorySyncCommit[] = [];

  constructor(
    private readonly mutations: MemoryPendingMutation[],
    private readonly attempts: LocalMemoryAttempt[] = [],
  ) {}

  async clientId(): Promise<string> { return 'client-1'; }
  async syncCursor(): Promise<string | undefined> { return undefined; }
  async syncablePendingMutations(limit: number): Promise<MemoryPendingMutation[]> {
    return this.mutations.slice(0, limit);
  }
  async unsyncedAttempts(limit: number): Promise<LocalMemoryAttempt[]> {
    return this.attempts.slice(0, limit);
  }
  async commitSyncResponse(commit: MemorySyncCommit): Promise<void> {
    this.commits.push(commit);
  }
}

function successfulResponse(request: { mutations: unknown[]; attempts: unknown[] }, hasMore = false): MemorySyncResponse {
  return {
    schemaVersion: 1,
    serverTime: now,
    cursor: 'cursor-1',
    acceptedMutationIds: request.mutations.map((entry) => (entry as { mutationId: string }).mutationId),
    acceptedAttemptIds: request.attempts.map((entry) => (entry as { attemptId: string }).attemptId),
    conflicts: [],
    changes: {},
    hasMore,
  };
}

const originalFetch = globalThis.fetch;
try {
  let requests = 0;
  globalThis.fetch = async (_input, init) => {
    requests += 1;
    const request = JSON.parse(String(init?.body)) as { mutations: unknown[]; attempts: unknown[] };
    return new Response(JSON.stringify(successfulResponse(request)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const localPendingRepository = new DiagnosticRepository(
    Array.from({ length: MEMORY_MUTATION_UPLOAD_LIMIT + 1 }, (_, index) => mutation(index)),
  );
  const localPending = await syncMemory(localPendingRepository as unknown as MemoryRepository, { force: true });
  assert.equal(localPending.status, 'synced');
  assert.equal(localPending.hasMore, true, 'batch上限時は同期完了扱いにしない');
  assert.equal(localPending.terminationReason, 'local-batch-pending');
  assert.equal(localPending.remainingMutationsAtLeast, 1, '取得済み候補から最低残件数を返す');
  assert.match(localPending.errorMessage ?? '', /少なくとも1件/, '利用者向けに未送信残件を表示する');
  assert.equal(localPending.uploadedMutations, MEMORY_MUTATION_UPLOAD_LIMIT);

  const flushLimitedRepository = new DiagnosticRepository(
    Array.from({ length: MEMORY_MUTATION_UPLOAD_LIMIT + 1 }, (_, index) => mutation(index + 20)),
  );
  const flushLimited = await flushMemorySync(flushLimitedRepository as unknown as MemoryRepository, 1, { force: true });
  assert.equal(flushLimited.limitReached, true);
  assert.equal(flushLimited.terminationReason, 'flush-round-limit');
  assert.equal(flushLimited.hasMore, true);
  assert.match(flushLimited.errorMessage ?? '', /上限（1回）/);
  assert.match(flushLimited.errorMessage ?? '', /端末に残って/);

  requests = 0;
  globalThis.fetch = async (_input, init) => {
    requests += 1;
    const request = JSON.parse(String(init?.body)) as { mutations: unknown[]; attempts: unknown[] };
    return new Response(JSON.stringify(successfulResponse(request, true)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const remotePagedRepository = new DiagnosticRepository([]);
  const remotePaged = await syncMemory(remotePagedRepository as unknown as MemoryRepository, { force: true });
  assert.equal(requests, MEMORY_INITIAL_PULL_ROUNDS, '初期pullの名前付き上限まで処理する');
  assert.equal(remotePaged.limitReached, true);
  assert.equal(remotePaged.terminationReason, 'remote-page-limit');
  assert.equal(remotePaged.hasMore, true);
  assert.equal(remotePaged.rounds, MEMORY_INITIAL_PULL_ROUNDS);
  assert.match(remotePaged.errorMessage ?? '', /クラウド側に続き/);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('✅ memory sync limit diagnostics passed');
