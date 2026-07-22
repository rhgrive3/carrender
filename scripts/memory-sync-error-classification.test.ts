import assert from 'node:assert/strict';
import {
  DEFAULT_MEMORY_REQUEST_TIMEOUT_MS,
  MemoryApiRequestError,
  apiSyncMemory,
  isMemoryApiError,
} from '../src/features/memory/infrastructure/api';
import { MemoryMutationDependencyCycleError } from '../src/features/memory/infrastructure/mutationDependencyGuard';
import {
  MemoryRepository,
  type LocalMemoryAttempt,
  type MemoryPendingMutation,
  type MemorySyncCommit,
} from '../src/features/memory/infrastructure/repositories';
import { memorySyncBackoffDelay, syncMemory } from '../src/features/memory/infrastructure/syncEngine';
import {
  classifyMemorySyncError,
  logUnexpectedMemorySyncError,
} from '../src/features/memory/infrastructure/syncError';

function mutation(overrides: Partial<MemoryPendingMutation>): MemoryPendingMutation {
  return {
    mutationId: 'mutation-1',
    clientId: 'client-1',
    entityType: 'item',
    entityId: 'item-1',
    entityKey: 'item:item-1',
    operation: 'create',
    payload: {},
    createdAt: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}

class ReadyRepository extends MemoryRepository {
  constructor() { super('sync-error-test'); }
  override async clientId(): Promise<string> { return 'client-1'; }
  override async syncCursor(): Promise<string | undefined> { return undefined; }
  override async syncablePendingMutations(): Promise<MemoryPendingMutation[]> { return []; }
  override async unsyncedAttempts(): Promise<LocalMemoryAttempt[]> { return []; }
  override async commitSyncResponse(_response: MemorySyncCommit): Promise<void> {}
}

class FailingReadRepository extends ReadyRepository {
  constructor(private readonly failure: unknown) { super(); }
  override async clientId(): Promise<string> { throw this.failure; }
}

const networkError = new MemoryApiRequestError('network failed', 'network');
assert.equal(isMemoryApiError(networkError), true, 'brand付きAPI errorを認識する');
assert.equal(
  isMemoryApiError(Object.assign(new Error('fake conflict'), { status: 409, isNetworkError: true })),
  false,
  '任意Errorへstatusを足しただけではAPI errorにしない',
);
assert.equal(
  isMemoryApiError(Object.assign(new Error('forged'), {
    name: 'MemoryApiError', source: 'memory-api', kind: 'http', status: '409',
  })),
  false,
  'brandのfield型が不正なら拒否する',
);

const offline = classifyMemorySyncError(networkError, { navigatorOnline: false });
assert.deepEqual(
  [offline.kind, offline.syncStatus, offline.retryable, offline.retryPolicy],
  ['network', 'offline', true, 'when-online'],
  'offlineはonline復帰待ちにする',
);
const onlineNetwork = classifyMemorySyncError(networkError, { navigatorOnline: true });
assert.deepEqual(
  [onlineNetwork.kind, onlineNetwork.syncStatus, onlineNetwork.retryPolicy],
  ['network', 'error', 'backoff'],
  'online中の接続失敗を端末offlineと断定しない',
);

const timeout = classifyMemorySyncError(new MemoryApiRequestError('timed out', 'timeout'));
assert.deepEqual(
  [timeout.kind, timeout.syncStatus, timeout.retryable, timeout.retryPolicy],
  ['timeout', 'error', true, 'retry-soon'],
  'timeoutは短時間後の再試行対象にする',
);
const serverFailure = classifyMemorySyncError(new MemoryApiRequestError('server failed', 'http', 503));
assert.deepEqual(
  [serverFailure.kind, serverFailure.syncStatus, serverFailure.retryable, serverFailure.retryPolicy],
  ['http', 'error', true, 'backoff'],
  '5xxはbackoff再試行対象にする',
);
const unauthorized = classifyMemorySyncError(new MemoryApiRequestError('login required', 'http', 401));
assert.deepEqual(
  [unauthorized.kind, unauthorized.retryable, unauthorized.retryPolicy],
  ['http', false, 'none'],
  '非一時的HTTP errorを自動再試行しない',
);
const conflict = classifyMemorySyncError(new MemoryApiRequestError('revision conflict', 'http', 409));
assert.deepEqual(
  [conflict.kind, conflict.syncStatus, conflict.retryPolicy],
  ['conflict', 'conflict', 'after-conflict-resolution'],
  'brand付きHTTP 409だけを競合導線へ送る',
);
const serverValidation = classifyMemorySyncError(new MemoryApiRequestError('invalid payload', 'http', 422));
assert.deepEqual(
  [serverValidation.kind, serverValidation.syncStatus, serverValidation.retryPolicy],
  ['validation', 'error', 'after-data-fix'],
  '400/422をデータ修正待ちとして扱う',
);

const cycleError = new MemoryMutationDependencyCycleError({
  sendable: [],
  blocked: [mutation({})],
  cyclePath: [mutation({})],
});
const cycle = classifyMemorySyncError(cycleError);
assert.deepEqual(
  [cycle.kind, cycle.syncStatus, cycle.retryPolicy],
  ['validation', 'error', 'after-data-fix'],
  'local dependency validationを通信失敗にしない',
);

const indexedDbFailure = Object.assign(new Error('IndexedDB transaction failed'), { name: 'TransactionInactiveError' });
const indexedDb = classifyMemorySyncError(indexedDbFailure, { navigatorOnline: false });
assert.deepEqual(
  [indexedDb.kind, indexedDb.syncStatus, indexedDb.retryable, indexedDb.retryPolicy],
  ['indexedDb', 'error', false, 'manual'],
  'IDB失敗はoffline/通信エラーにしない',
);
const rawAbort = classifyMemorySyncError(Object.assign(new Error('transaction aborted'), { name: 'AbortError' }));
assert.equal(rawAbort.kind, 'indexedDb', 'API brandのないAbortErrorをtimeoutへ誤分類しない');

const fakeConflict = Object.assign(new Error('internal error with status'), { status: 409 });
const unknown = classifyMemorySyncError(fakeConflict);
assert.deepEqual(
  [unknown.kind, unknown.syncStatus, unknown.retryPolicy],
  ['unknown', 'error', 'manual'],
  '内部Errorの偽409を競合扱いしない',
);
assert.equal(unknown.diagnostic.message, 'internal error with status');
assert.ok(unknown.diagnostic.stack, 'unknownの診断stackを保持する');
let loggedDiagnostic: unknown;
const originalConsoleError = console.error;
console.error = (...values: unknown[]) => { loggedDiagnostic = values; };
try {
  logUnexpectedMemorySyncError(unknown, fakeConflict);
} finally {
  console.error = originalConsoleError;
}
assert.ok(Array.isArray(loggedDiagnostic), 'unknownを診断ログへ残す');

const idbResult = await syncMemory(new FailingReadRepository(indexedDbFailure));
assert.deepEqual(
  [idbResult.status, idbResult.errorKind, idbResult.retryPolicy],
  ['error', 'indexedDb', 'manual'],
  'syncEngine全体でもrepository/IDB例外を保存エラーとして返す',
);
assert.match(idbResult.errorMessage ?? '', /端末内の暗記データ/);

const originalFetch = globalThis.fetch;
const originalConsole = console.error;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
try {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'server conflict' }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  });
  const conflictResult = await syncMemory(new ReadyRepository());
  assert.deepEqual(
    [conflictResult.status, conflictResult.errorKind, conflictResult.retryPolicy],
    ['conflict', 'conflict', 'after-conflict-resolution'],
    '実APIの409だけを競合statusへ変換する',
  );

  let unknownLogCount = 0;
  console.error = () => { unknownLogCount += 1; };
  const fake409Result = await syncMemory(new FailingReadRepository(fakeConflict));
  assert.deepEqual(
    [fake409Result.status, fake409Result.errorKind],
    ['error', 'unknown'],
    'syncEngineでも内部偽409を競合へ送らない',
  );
  assert.equal(unknownLogCount, 1, 'syncEngineがunknown診断を握り潰さない');
  console.error = originalConsole;

  globalThis.fetch = async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  const timeoutResult = await syncMemory(new ReadyRepository(), { random: () => 0.5 });
  assert.deepEqual(
    [timeoutResult.status, timeoutResult.errorKind, timeoutResult.retryPolicy],
    ['error', 'timeout', 'retry-soon'],
    'fetch abortをtimeoutとして返す',
  );
  assert.ok((timeoutResult.retryAfterMs ?? 0) > 0, 'timeoutへ再試行待機時間を付ける');

  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'temporary outage' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
  const unavailableRepository = new ReadyRepository();
  let now = 1_000;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({ error: 'temporary outage' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const unavailableResult = await syncMemory(unavailableRepository, { now: () => now, random: () => 0.5 });
  assert.deepEqual(
    [unavailableResult.status, unavailableResult.errorKind, unavailableResult.retryable, unavailableResult.retryPolicy],
    ['error', 'http', true, 'backoff'],
    '実APIの5xxをbackoff対象として返す',
  );
  assert.equal(fetchCount, 1);
  const deferred = await syncMemory(unavailableRepository, { now: () => now, random: () => 0.5 });
  assert.equal(fetchCount, 1, 'cooldown中の自動同期はrequestを重ねない');
  assert.ok((deferred.retryAfterMs ?? 0) > 0);

  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({
      schemaVersion: 1,
      serverTime: '2026-07-22T00:00:00.000Z',
      cursor: 'cursor-1',
      acceptedMutationIds: [],
      acceptedAttemptIds: [],
      conflicts: [],
      changes: {},
      hasMore: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const forced = await syncMemory(unavailableRepository, { force: true, now: () => now, random: () => 0.5 });
  assert.equal(forced.status, 'synced', '手動同期はcooldownを解除して即時requestする');
  assert.equal(fetchCount, 2);

  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  const offlineHintRepository = new ReadyRepository();
  const advisoryResult = await syncMemory(offlineHintRepository, { force: true });
  assert.equal(advisoryResult.status, 'synced', 'navigator.onLine=falseでも実request成功を優先する');

  assert.equal(memorySyncBackoffDelay(1, 0.5), 2_000);
  assert.equal(memorySyncBackoffDelay(2, 0.5), 4_000);
  assert.equal(memorySyncBackoffDelay(20, 0.5), 60_000, 'backoffへ上限を設ける');
  assert.equal(DEFAULT_MEMORY_REQUEST_TIMEOUT_MS, 20_000);

  globalThis.fetch = () => new Promise<Response>(() => {});
  await assert.rejects(
    apiSyncMemory({ schemaVersion: 1, clientId: 'client-1', mutations: [], attempts: [] }, { timeoutMs: 5 }),
    (error: unknown) => isMemoryApiError(error) && error.kind === 'timeout',
    '応答しないrequestをAbortControllerでtimeoutにする',
  );
} finally {
  globalThis.fetch = originalFetch;
  console.error = originalConsole;
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete (globalThis as { navigator?: unknown }).navigator;
}

console.log('✅ memory sync error classification regressions passed');
