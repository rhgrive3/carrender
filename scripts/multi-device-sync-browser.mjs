import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const cwd = new URL('..', import.meta.url).pathname;
const base = 'http://127.0.0.1:4194/';
let vite;
let browser;
let output = '';

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {
      // Vite is starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite did not become ready\n${output}`);
}

const cloud = {
  version: 0,
  state: null,
  mutations: new Map(),
  attempts: new Map(),
};

function jsonResponse(route, status, body) {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  });
}

function installSyncRoute(context) {
  const connectivity = { online: true };
  context.route('**/__sync/**', async (route) => {
    if (!connectivity.online) return route.abort('internetdisconnected');
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/__sync/main' && request.method() === 'GET') {
      return jsonResponse(route, 200, { version: cloud.version, state: cloud.state });
    }
    if (url.pathname === '/__sync/main' && request.method() === 'PUT') {
      const payload = request.postDataJSON();
      const previous = cloud.mutations.get(payload.mutationId);
      if (previous) return jsonResponse(route, previous.status, previous.body);
      if (payload.expectedVersion !== cloud.version) {
        const response = { status: 409, body: { version: cloud.version, state: cloud.state, code: 'VERSION_CONFLICT' } };
        cloud.mutations.set(payload.mutationId, response);
        return jsonResponse(route, response.status, response.body);
      }
      cloud.version += 1;
      cloud.state = payload.state;
      const response = { status: 200, body: { ok: true, version: cloud.version } };
      cloud.mutations.set(payload.mutationId, response);
      return jsonResponse(route, response.status, response.body);
    }
    if (url.pathname === '/__sync/attempt' && request.method() === 'POST') {
      const attempt = request.postDataJSON();
      if (!cloud.attempts.has(attempt.id)) cloud.attempts.set(attempt.id, attempt);
      return jsonResponse(route, 200, { ok: true, uniqueAttempts: cloud.attempts.size });
    }
    return jsonResponse(route, 404, { error: 'not found' });
  });
  return connectivity;
}

async function preparePage(page, deviceId) {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ({ deviceId }) => {
    const { emptyState } = await import('/src/state/AppContextBase.tsx');
    const {
      mergeMainStates,
      snapshotMainStateEntityHashes,
    } = await import('/src/lib/mainStateMerge.ts');

    const storageKey = `multi-device-sync-e2e:${deviceId}`;
    const restored = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    let state = restored?.state ?? emptyState();
    let version = restored?.version ?? 0;
    let baseHashes = restored?.baseHashes ?? snapshotMainStateEntityHashes(state);
    let status = restored?.status ?? 'synced';
    let conflicts = restored?.conflicts ?? [];

    const persist = () => localStorage.setItem(storageKey, JSON.stringify({
      state,
      version,
      baseHashes,
      status,
      conflicts,
    }));
    const clone = (value) => JSON.parse(JSON.stringify(value));

    window.__MULTI_DEVICE_SYNC_E2E__ = {
      async seed() {
        const response = await fetch('/__sync/main', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedVersion: 0, mutationId: 'seed', state }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(`seed failed: ${JSON.stringify(result)}`);
        version = result.version;
        baseHashes = snapshotMainStateEntityHashes(state);
        persist();
        return result;
      },
      async pull() {
        const response = await fetch('/__sync/main');
        const result = await response.json();
        if (!response.ok) throw new Error(`pull failed: ${JSON.stringify(result)}`);
        state = result.state;
        version = result.version;
        baseHashes = snapshotMainStateEntityHashes(state);
        status = 'synced';
        conflicts = [];
        persist();
        return clone(result);
      },
      addSubject(id, name) {
        state = { ...state, subjects: [...state.subjects, { id, name, color: '#6366f1', importance: 3, weakness: 3 }] };
        status = 'dirty';
        persist();
      },
      renameSubject(id, name) {
        state = { ...state, subjects: state.subjects.map((subject) => subject.id === id ? { ...subject, name } : subject) };
        status = 'dirty';
        persist();
      },
      async sync(mutationId) {
        const send = async (expectedVersion, candidate, id) => {
          const response = await fetch('/__sync/main', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expectedVersion, mutationId: id, state: candidate }),
          });
          return { response, result: await response.json() };
        };
        try {
          let sent = await send(version, state, mutationId);
          if (sent.response.status === 409) {
            const merged = mergeMainStates(baseHashes, state, sent.result.state, new Date('2026-07-23T00:00:00.000Z'));
            if (!merged.merged) {
              status = 'conflict';
              conflicts = merged.conflicts;
              persist();
              return { status, conflicts: clone(conflicts) };
            }
            state = merged.merged;
            version = sent.result.version;
            sent = await send(version, state, `${mutationId}:rebased`);
          }
          if (!sent.response.ok) throw new Error(`sync failed: ${JSON.stringify(sent.result)}`);
          version = sent.result.version;
          baseHashes = snapshotMainStateEntityHashes(state);
          status = 'synced';
          conflicts = [];
          persist();
          return { status, version };
        } catch (error) {
          status = 'offline';
          persist();
          return { status, message: error instanceof Error ? error.message : String(error) };
        }
      },
      async postAttempt(attempt) {
        const response = await fetch('/__sync/attempt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(attempt),
        });
        return response.json();
      },
      snapshot() {
        return clone({ state, version, status, conflicts });
      },
    };
  }, { deviceId });
}

try {
  vite = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4194', '--strictPort'], {
    cwd,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const append = (chunk) => { output = `${output}${chunk.toString()}`.slice(-20_000); };
  vite.stdout.on('data', append);
  vite.stderr.on('data', append);
  await waitForServer();

  browser = await chromium.launch();
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const connectivityA = installSyncRoute(contextA);
  installSyncRoute(contextB);
  let pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await preparePage(pageA, 'device-a');
  await preparePage(pageB, 'device-b');

  await pageA.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.seed());
  await pageB.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.pull());

  await pageA.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.addSubject('subject-a', '端末Aの科目'));
  await pageB.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.addSubject('subject-b', '端末Bの科目'));
  assert.equal((await pageA.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.sync('add-a'))).status, 'synced');
  assert.equal((await pageB.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.sync('add-b'))).status, 'synced');
  await pageA.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.pull());
  const concurrentAdds = await pageA.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.snapshot());
  assert.deepEqual(concurrentAdds.state.subjects.map((subject) => subject.id).sort(), ['subject-a', 'subject-b']);

  await pageB.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.pull());
  await pageA.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.renameSubject('subject-a', 'A側の変更'));
  await pageB.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.renameSubject('subject-a', 'B側の変更'));
  assert.equal((await pageA.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.sync('rename-a'))).status, 'synced');
  const conflict = await pageB.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.sync('rename-b'));
  assert.equal(conflict.status, 'conflict');
  assert.deepEqual(conflict.conflicts, [{ section: 'subjects', key: 'subject-a', reason: 'bothChanged' }]);
  await pageB.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.pull());
  assert.equal((await pageB.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.snapshot())).state.subjects.find((subject) => subject.id === 'subject-a').name, 'A側の変更');

  connectivityA.online = false;
  await pageA.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.addSubject('subject-offline', 'オフライン追加'));
  assert.equal((await pageA.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.sync('offline-add'))).status, 'offline');
  await pageA.close();
  pageA = await contextA.newPage();
  await preparePage(pageA, 'device-a');
  assert.equal((await pageA.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.snapshot())).status, 'offline');
  connectivityA.online = true;
  assert.equal((await pageA.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.sync('offline-add-retry'))).status, 'synced');

  const attempt = { id: 'attempt-once', cardId: 'card-1', correct: true, responseMs: 1200 };
  assert.equal((await pageA.evaluate((value) => window.__MULTI_DEVICE_SYNC_E2E__.postAttempt(value), attempt)).uniqueAttempts, 1);
  assert.equal((await pageA.evaluate((value) => window.__MULTI_DEVICE_SYNC_E2E__.postAttempt(value), attempt)).uniqueAttempts, 1);
  assert.equal((await pageB.evaluate((value) => window.__MULTI_DEVICE_SYNC_E2E__.postAttempt(value), attempt)).uniqueAttempts, 1);

  await pageA.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.pull());
  await pageB.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.pull());
  const finalA = await pageA.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.snapshot());
  const finalB = await pageB.evaluate(() => window.__MULTI_DEVICE_SYNC_E2E__.snapshot());
  assert.deepEqual(finalA.state, finalB.state, '両端末が同じAppStateへ収束する');
  assert.deepEqual(finalA.state, cloud.state, '端末とクラウドが同じAppStateへ収束する');
  assert.equal(finalA.version, cloud.version);
  assert.equal(finalB.version, cloud.version);
  assert.equal(cloud.attempts.size, 1, '重複attemptは統計へ一度だけ反映する');
  assert.ok(finalA.state.subjects.some((subject) => subject.id === 'subject-offline'), 'タブ交代後もオフライン編集を送信する');

  console.log('✅ multi-tab/two-device conflict, rebase, offline recovery, idempotent attempt, and convergence passed');
} finally {
  await browser?.close();
  if (vite?.pid) {
    try {
      if (process.platform === 'win32') vite.kill('SIGTERM');
      else process.kill(-vite.pid, 'SIGTERM');
    } catch {
      vite.kill('SIGTERM');
    }
  }
}
