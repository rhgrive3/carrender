import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const cwd = new URL('..', import.meta.url).pathname;
const base = 'http://127.0.0.1:4182/';
let server;
let output = '';

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {
      // Vite is starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite did not start\n${output}`);
}

server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4182', '--strictPort'], {
  cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-20_000); });
server.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(-20_000); });

const browser = await chromium.launch({ headless: true });
try {
  await waitForServer();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base);

  const leaseResult = await page.evaluate(async () => {
    const { IndexedDbMemoryStore, deleteMemoryDatabase } = await import('/src/features/memory/infrastructure/indexedDb.ts');
    const owner = `lease-${crypto.randomUUID()}`;
    await deleteMemoryDatabase(owner);
    const first = new IndexedDbMemoryStore(owner);
    const second = new IndexedDbMemoryStore(owner);
    await Promise.all([first.setMeta('first', 1), second.setMeta('second', 2)]);
    first.close();
    const secondValue = await second.getMeta('second');
    await second.setMeta('after-first-close', 3);
    const afterClose = await second.getMeta('after-first-close');
    second.close();
    await deleteMemoryDatabase(owner);
    return { secondValue, afterClose };
  });
  assert.deepEqual(leaseResult, { secondValue: 2, afterClose: 3 }, 'one store close must not close a shared owner connection');

  const delayedResult = await page.evaluate(async () => {
    const module = await import('/src/features/memory/infrastructure/indexedDb.ts');
    const owner = `delayed-${crypto.randomUUID()}`;
    await module.deleteMemoryDatabase(owner);
    const name = `studycommander-memory-v1:${owner.normalize('NFKC')}`;
    const blocker = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const [storeName, keyPath] of [
          ['memoryItems', 'id'], ['memorySenses', 'id'], ['memoryAnswers', 'id'],
          ['memoryExamples', 'id'], ['memoryExercises', 'id'], ['memorySets', 'id'],
          ['memorySetMembers', ['setId', 'itemId']], ['memoryStats', 'id'],
          ['memoryAttempts', 'attemptId'], ['memorySessions', 'id'],
          ['memoryPendingMutations', 'mutationId'], ['memoryConflicts', 'id'], ['memoryMeta', 'key'],
        ]) db.createObjectStore(storeName, { keyPath });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stale = new module.IndexedDbMemoryStore(owner);
    const staleRead = stale.getMeta('never').then(() => 'resolved', () => 'rejected');
    await new Promise((resolve) => setTimeout(resolve, 50));
    stale.close();
    blocker.close();
    const staleStatus = await staleRead;
    const current = new module.IndexedDbMemoryStore(owner);
    await current.setMeta('current', 'ok');
    const currentValue = await current.getMeta('current');
    current.close();
    await module.deleteMemoryDatabase(owner);
    return { staleStatus, currentValue };
  });

  assert.deepEqual(delayedResult, { staleStatus: 'rejected', currentValue: 'ok' }, 'open finishing after close must not poison the next connection cache');

  const legacyOwner = `legacy-${crypto.randomUUID()}`;
  const targetOwner = `target-${crypto.randomUUID()}`;
  const holder = await context.newPage();
  await holder.goto(base);
  await holder.evaluate(async ({ legacyOwner }) => {
    const { IndexedDbMemoryStore } = await import('/src/features/memory/infrastructure/indexedDb.ts');
    const seed = new IndexedDbMemoryStore(legacyOwner);
    await seed.setMeta('clientId', 'legacy-client-id');
    seed.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const name = `studycommander-memory-v1:${legacyOwner.normalize('NFKC')}`;
    window.__heldLegacyDatabase = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }, { legacyOwner });

  const migration = await page.evaluate(async ({ legacyOwner, targetOwner }) => {
    const module = await import('/src/features/memory/infrastructure/indexedDb.ts');
    const startedAt = performance.now();
    await module.migrateMemoryDatabaseOwner(legacyOwner, targetOwner);
    const elapsedMs = performance.now() - startedAt;
    const target = new module.IndexedDbMemoryStore(targetOwner);
    const clientId = await target.getMeta('clientId');
    target.close();
    return {
      elapsedMs,
      clientId,
      cleanupPending: module.memoryDatabaseCleanupPending(legacyOwner),
    };
  }, { legacyOwner, targetOwner });
  assert.equal(migration.clientId, 'legacy-client-id', 'target copy must commit before blocked source cleanup returns');
  assert.equal(migration.cleanupPending, true, 'blocked source deletion must remain observable as pending cleanup');
  assert.ok(migration.elapsedMs < 2_000, `blocked migration must not hang authentication (${migration.elapsedMs}ms)`);

  await holder.evaluate(() => window.__heldLegacyDatabase.close());
  await page.waitForFunction(async (legacyOwner) => {
    const module = await import('/src/features/memory/infrastructure/indexedDb.ts');
    return !module.memoryDatabaseCleanupPending(legacyOwner);
  }, legacyOwner, { timeout: 5_000 });
  const preserved = await page.evaluate(async ({ targetOwner }) => {
    const module = await import('/src/features/memory/infrastructure/indexedDb.ts');
    const target = new module.IndexedDbMemoryStore(targetOwner);
    const clientId = await target.getMeta('clientId');
    target.close();
    await module.deleteMemoryDatabase(targetOwner);
    return clientId;
  }, { targetOwner });
  assert.equal(preserved, 'legacy-client-id', 'deferred legacy cleanup must not remove migrated target data');

  console.log('✅ IndexedDB owner connections survive close/open races and blocked migration cleanup');
} finally {
  await browser.close();
  if (server?.pid) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill('SIGTERM'); }
  }
}
