import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const validatedSource = await readFile(
  new URL('../src/features/memory/infrastructure/validatedRepository.ts', import.meta.url),
  'utf8',
);
const syncSource = await readFile(
  new URL('../src/features/memory/infrastructure/syncEngine.ts', import.meta.url),
  'utf8',
);
const repositorySource = await readFile(
  new URL('../src/features/memory/infrastructure/repositories.ts', import.meta.url),
  'utf8',
);

for (const method of ['markSynced', 'addConflicts', 'applyRemoteChanges', 'setSyncCursor']) {
  assert.match(
    validatedSource,
    new RegExp(`override async ${method}\\(`),
    `ValidatedMemoryRepository must block low-level sync method ${method}`,
  );
}
assert.equal(
  (validatedSource.match(/commitSyncResponseで原子的に保存してください/gu) ?? []).length,
  4,
  'every low-level sync primitive must fail with the atomic commit guidance',
);

for (const forbidden of ['.markSynced(', '.addConflicts(', '.applyRemoteChanges(', '.setSyncCursor(']) {
  assert.equal(
    syncSource.includes(forbidden),
    false,
    `production sync engine must not call ${forbidden}`,
  );
}
assert.match(syncSource, /await repository\.commitSyncResponse\(\{/u, 'sync engine must use the atomic response commit');

const commitStart = repositorySource.indexOf('async commitSyncResponse(response: MemorySyncCommit)');
const cursorStart = repositorySource.indexOf('async syncCursor()', commitStart);
assert.ok(commitStart >= 0 && cursorStart > commitStart, 'atomic commit implementation must be present');
const commitBody = repositorySource.slice(commitStart, cursorStart);
assert.match(commitBody, /this\.store\.transaction\(stores, 'readwrite'/u, 'commit must use one readwrite transaction');
assert.match(commitBody, /MEMORY_STORES\.pendingMutations/u, 'queue receipts must share the transaction');
assert.match(commitBody, /MEMORY_STORES\.attempts/u, 'attempt receipts must share the transaction');
assert.match(commitBody, /MEMORY_STORES\.conflicts/u, 'conflicts must share the transaction');
assert.match(commitBody, /MEMORY_STORES\.meta/u, 'cursor must share the transaction');
assert.match(commitBody, /applyRemoteChangesInTransaction\(transaction/u, 'remote rows must share the transaction');
assert.match(commitBody, /key: 'syncCursor'/u, 'cursor advancement must happen inside the atomic commit');

console.log('✅ memory sync atomic repository contract passed');
