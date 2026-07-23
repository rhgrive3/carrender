/** Browser integration contract for cursor-limited memory repository reads. */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const cwd = new URL('..', import.meta.url).pathname;
const externalBase = process.env.MEMORY_TEST_BASE_URL;
const base = externalBase ?? 'http://127.0.0.1:4182/';
let server;
let output = '';
let browser;
let failures = 0;

function check(name, condition, detail) {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures += 1; console.error(`  ❌ ${name}`, detail ?? ''); }
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Vite did not become ready\n${output}`);
}

try {
  if (!externalBase) {
    server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4182', '--strictPort'], {
      cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const append = (chunk) => { output = `${output}${chunk}`.slice(-20_000); };
    server.stdout.on('data', append);
    server.stderr.on('data', append);
  }
  await waitForServer();
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(base, { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(async () => {
    const { deleteMemoryDatabase, MEMORY_STORES } = await import('/src/features/memory/infrastructure/indexedDb.ts');
    const { MemoryRepository } = await import('/src/features/memory/infrastructure/repositories.ts');
    const owner = `cursor-${crypto.randomUUID()}`;
    await deleteMemoryDatabase(owner);
    const repository = new MemoryRepository(owner);
    await repository.clientId();

    const sessionRows = Array.from({ length: 250 }, (_, index) => ({
      id: `session-${String(index).padStart(4, '0')}`,
      status: index === 249 ? 'active' : 'completed',
      selectedSetIds: [], initialTargetIds: [],
      config: { questionCount: { type: 'count', count: 10 }, direction: 'output', includeUnverifiedAi: false },
      seed: `seed-${index}`, queueState: {}, completedTargetIds: [], needsReviewTargetIds: [], answerCount: index,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      ...(index === 249 ? {} : { completedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString() }),
    }));
    const attemptRows = Array.from({ length: 2_000 }, (_, index) => ({
      attemptId: `attempt-${String(index).padStart(5, '0')}`,
      sessionId: sessionRows[index % sessionRows.length].id,
      clientId: 'cursor-client', itemId: 'item-1', senseId: 'sense-1', answerId: 'answer-1',
      targetId: 'target-1', mode: index % 2 === 0 ? 'output' : 'input', exerciseType: 'flashcard',
      assessment: 'correct', errorTypes: [], hintUsed: false, responseMs: 100,
      createdAt: new Date(Date.UTC(2026, 0, 2, 0, 0, index)).toISOString(),
      ...(index < 1_900 ? { syncedAt: '2026-01-03T00:00:00.000Z' } : {}),
      ...(index % 37 === 0 ? { undoneAt: '2026-01-04T00:00:00.000Z' } : {}),
    }));
    const conflicts = Array.from({ length: 120 }, (_, index) => ({
      id: `conflict-${String(index).padStart(4, '0')}`,
      entityType: 'item', entityId: `item-${index}`, entityKey: `item:item-${index}`,
      localValue: {}, serverValue: {}, createdAt: new Date(Date.UTC(2026, 0, 5, 0, 0, index)).toISOString(),
      ...(index < 20 ? { resolvedAt: '2026-01-06T00:00:00.000Z', resolution: 'server' } : {}),
    }));
    await repository.store.write([
      ...sessionRows.map((value) => ({ store: MEMORY_STORES.sessions, type: 'put', value })),
      ...attemptRows.map((value) => ({ store: MEMORY_STORES.attempts, type: 'put', value })),
      ...conflicts.map((value) => ({ store: MEMORY_STORES.conflicts, type: 'put', value })),
    ]);

    const originalGetAll = repository.store.getAll.bind(repository.store);
    const originalGetAllFromIndex = repository.store.getAllFromIndex.bind(repository.store);
    let forbiddenFullReads = 0;
    repository.store.getAll = async () => { forbiddenFullReads += 1; throw new Error('full getAll is forbidden'); };
    repository.store.getAllFromIndex = async () => { forbiddenFullReads += 1; throw new Error('index getAll is forbidden'); };

    const sessionPage1 = await repository.listSessionsPage(20);
    const sessionPage2 = await repository.listSessionsPage(20, sessionPage1.nextCursor);
    const latestSessions = sessionPage1.rows;
    const active = await repository.getActiveSession();
    const targetPage1 = await repository.getTargetAttemptsPage('target-1', 25);
    const targetPage2 = await repository.getTargetAttemptsPage('target-1', 25, targetPage1.nextCursor);
    const targetHistory = targetPage1.rows;
    const inputHistory = await repository.getStatTargetAttempts('sense', 'sense-1', 'input', 17);
    const unsynced = await repository.unsyncedAttempts(20);
    const conflictPage1 = await repository.listConflictsPage(50);
    const conflictPage2 = await repository.listConflictsPage(50, conflictPage1.nextCursor);
    const conflictPage = conflictPage1.rows;
    const conflictCount = await repository.countUnresolvedConflicts();
    const pendingCount = await repository.countPendingMutations();

    repository.store.getAll = originalGetAll;
    repository.store.getAllFromIndex = originalGetAllFromIndex;
    repository.close();
    await deleteMemoryDatabase(owner);
    return {
      forbiddenFullReads,
      latestSessionIds: latestSessions.map((entry) => entry.id),
      sessionSecondPageIds: sessionPage2.rows.map((entry) => entry.id),
      activeId: active?.id,
      targetAttemptIds: targetHistory.map((entry) => entry.attemptId),
      targetSecondPageIds: targetPage2.rows.map((entry) => entry.attemptId),
      inputModes: inputHistory.map((entry) => entry.mode),
      unsyncedAttemptIds: unsynced.map((entry) => entry.attemptId),
      conflictPageIds: conflictPage.map((entry) => entry.id),
      conflictSecondPageIds: conflictPage2.rows.map((entry) => entry.id),
      conflictCount,
      pendingCount,
    };
  });

  console.log('--- Memory cursor pagination ---');
  check('一覧経路でgetAll/getAllFromIndexへ退行しない', result.forbiddenFullReads === 0, result);
  check('sessionをupdatedAt降順で20件ずつ重複なく取得', result.latestSessionIds.length === 20
    && result.latestSessionIds[0] === 'session-0249'
    && result.latestSessionIds.at(-1) === 'session-0230'
    && result.sessionSecondPageIds[0] === 'session-0229'
    && new Set([...result.latestSessionIds, ...result.sessionSecondPageIds]).size === 40, result);
  check('active sessionを複合indexから1件取得', result.activeId === 'session-0249', result.activeId);
  check('target履歴を取消行を除外して新しい順にcursorページング', result.targetAttemptIds.length === 25
    && !result.targetAttemptIds.includes('attempt-01998')
    && result.targetAttemptIds[0] === 'attempt-01999'
    && new Set([...result.targetAttemptIds, ...result.targetSecondPageIds]).size === 50, result);
  check('mode filter後も要求件数までcursor走査', result.inputModes.length === 17
    && result.inputModes.every((mode) => mode === 'input'), result.inputModes);
  check('未同期attemptを古い順に20件だけ取得', result.unsyncedAttemptIds.length === 20
    && result.unsyncedAttemptIds[0] === 'attempt-01900', result.unsyncedAttemptIds);
  check('未解決競合を新しい順に50件ずつ重複なく表示し総数は別count', result.conflictPageIds.length === 50
    && result.conflictPageIds[0] === 'conflict-0119'
    && result.conflictSecondPageIds.length === 50
    && new Set([...result.conflictPageIds, ...result.conflictSecondPageIds]).size === 100
    && result.conflictCount === 100, result);
  check('pending件数は配列化せずcount', result.pendingCount === 0, result.pendingCount);
} catch (error) {
  failures += 1;
  console.error('  ❌ cursor pagination browser test crashed', error);
  if (output) console.error(output);
} finally {
  await browser?.close();
  if (server?.pid) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill('SIGTERM'); }
  }
}

console.log(failures === 0 ? '\n🎉 ALL PASS (memory cursor pagination)' : `\n💥 ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
