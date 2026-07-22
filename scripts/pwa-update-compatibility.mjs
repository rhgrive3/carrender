import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4193;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TIMER_KEY = 'studycommander_timer_v1';

function contentType(pathname) {
  const extension = extname(pathname);
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.js') return 'text/javascript; charset=utf-8';
  if (extension === '.json') return 'application/json; charset=utf-8';
  if (extension === '.txt') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function nativeRegisterAdapter() {
  return `
type RegisterOptions = { immediate?: boolean; onNeedRefresh?: () => void };

function registerSW(options: RegisterOptions = {}) {
  const registrationPromise = navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });

  const waitForWaiting = async (registration: ServiceWorkerRegistration) => {
    if (registration.waiting) return registration.waiting;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (registration.waiting) return registration.waiting;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  };

  void registrationPromise.then((registration) => {
    const notify = () => {
      if (registration.waiting) options.onNeedRefresh?.();
    };
    notify();
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) notify();
      });
    });
  });

  return async (reloadPage = true) => {
    const registration = await registrationPromise;
    let waiting = registration.waiting;
    if (!waiting) {
      await registration.update();
      waiting = await waitForWaiting(registration);
    }
    if (!waiting) throw new Error('waiting Service Workerが見つかりません');
    const controlled = new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
    });
    waiting.postMessage({ type: 'SKIP_WAITING' });
    await controlled;
    if (reloadPage) window.location.reload();
  };
}
`;
}

function appSource(version) {
  const databaseVersion = version === 'A' ? 1 : 2;
  return `
import { registerSafeServiceWorkerUpdate } from './serviceWorkerUpdate.js';

const BUILD_VERSION = ${JSON.stringify(version)};
const DATABASE_NAME = 'studycommander-pwa-update-compatibility';
const DATABASE_VERSION = ${databaseVersion};
const TIMER_KEY = ${JSON.stringify(TIMER_KEY)};
let unsaved = false;

window.addEventListener('beforeunload', (event) => {
  if (unsaved) event.preventDefault();
});

document.body.dataset.buildVersion = BUILD_VERSION;
document.getElementById('build-version').textContent = BUILD_VERSION;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener('upgradeneeded', () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('state')) database.createObjectStore('state', { keyPath: 'key' });
      if (DATABASE_VERSION >= 2 && !database.objectStoreNames.contains('meta')) {
        const meta = database.createObjectStore('meta', { keyPath: 'key' });
        meta.put({ key: 'migration', value: 'v2' });
      }
    });
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB open failed')), { once: true });
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB transaction aborted')), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB transaction failed')), { once: true });
  });
}

const databasePromise = openDatabase();

async function writeState(value) {
  const database = await databasePromise;
  const transaction = database.transaction('state', 'readwrite');
  transaction.objectStore('state').put({ key: 'app', value });
  await transactionDone(transaction);
}

async function readState() {
  const database = await databasePromise;
  const transaction = database.transaction('state', 'readonly');
  const row = await requestResult(transaction.objectStore('state').get('app'));
  await transactionDone(transaction);
  return row?.value ?? null;
}

async function readMigration() {
  const database = await databasePromise;
  if (!database.objectStoreNames.contains('meta')) return null;
  const transaction = database.transaction('meta', 'readonly');
  const row = await requestResult(transaction.objectStore('meta').get('migration'));
  await transactionDone(transaction);
  return row?.value ?? null;
}

async function waitForWaiting(registration) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (registration.waiting) return registration.waiting.state;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('更新版Service Workerがwaitingになりませんでした');
}

registerSafeServiceWorkerUpdate();

window.__PWA_TEST__ = {
  ready: Promise.all([navigator.serviceWorker.ready, databasePromise]).then(() => true),
  buildVersion: BUILD_VERSION,
  writeState,
  readState,
  readMigration,
  databaseVersion: async () => (await databasePromise).version,
  setTimer(active) {
    if (active) localStorage.setItem(TIMER_KEY, JSON.stringify({ active: true }));
    else localStorage.removeItem(TIMER_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: TIMER_KEY }));
  },
  setUnsaved(active) {
    unsaved = Boolean(active);
    document.body.classList.toggle('has-unsaved-test-input', unsaved);
  },
  async triggerUpdate() {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) throw new Error('Service Worker registrationがありません');
    await registration.update();
    return waitForWaiting(registration);
  },
  async requestCompatibility() {
    const response = await fetch('/api/compat', { headers: { 'X-Client-Version': BUILD_VERSION } });
    const data = await response.json();
    const alert = document.getElementById('api-alert');
    if (!response.ok) {
      alert.hidden = false;
      alert.textContent = typeof data.error === 'string' ? data.error : 'アプリを更新してください';
    }
    return { status: response.status, ...data };
  },
  cacheKeys: () => caches.keys(),
  versionAsset: () => fetch('/version.txt').then((response) => response.text()),
};
`;
}

function serviceWorkerSource(version) {
  return `
const VERSION = ${JSON.stringify(version)};
const CACHE_NAME = 'studycommander-pwa-compat-' + VERSION;
const CACHE_PREFIX = 'studycommander-pwa-compat-';
const ASSETS = ['/', '/index.html', '/app.js', '/serviceWorkerUpdate.js', '/version.txt'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
      return (await cache.match('/index.html')) ?? fetch(event.request);
    }));
    return;
  }
  event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
    return (await cache.match(event.request)) ?? fetch(event.request);
  }));
});
`;
}

async function writeVersion(directory, version, coordinatorSource) {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'index.html'), `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>PWA update compatibility ${version}</title></head>
<body><main><h1>Build <span id="build-version">${version}</span></h1><div id="api-alert" role="alert" hidden></div></main><script type="module" src="/app.js"></script></body></html>`, 'utf8');
  await writeFile(join(directory, 'app.js'), appSource(version), 'utf8');
  await writeFile(join(directory, 'serviceWorkerUpdate.js'), coordinatorSource, 'utf8');
  await writeFile(join(directory, 'sw.js'), serviceWorkerSource(version), 'utf8');
  await writeFile(join(directory, 'version.txt'), version, 'utf8');
}

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {
      // Server is starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('PWA compatibility server did not start');
}

const viteConfig = await readFile(join(ROOT, 'vite.config.ts'), 'utf8');
const coordinatorTypeScript = await readFile(join(ROOT, 'src/lib/serviceWorkerUpdate.ts'), 'utf8');
const apiSource = await readFile(join(ROOT, 'src/lib/api.ts'), 'utf8');
assert.match(viteConfig, /registerType:\s*['"]prompt['"]/, 'PWA update must remain user-prompted');
assert.match(viteConfig, /cleanupOutdatedCaches:\s*true/, 'outdated Workbox caches must be cleaned');
assert.match(viteConfig, /navigateFallback:\s*['"]\/index\.html['"]/, 'offline navigation fallback must remain configured');
assert.match(coordinatorTypeScript, /onNeedRefresh\(\)/, 'production update coordinator must expose waiting updates');
assert.match(coordinatorTypeScript, /serviceWorkerUpdateBlockers\(\)/, 'production update coordinator must recheck blockers');
assert.match(coordinatorTypeScript, /updateServiceWorker\(true\)/, 'production update coordinator must activate and reload explicitly');
assert.match(apiSource, /typeof record\?\.error === ['"]string['"]/, 'API errors must preserve the server user-facing message');
assert.match(apiSource, /typeof record\?\.code === ['"]string['"]/, 'API compatibility codes must be preserved');

const importLine = "import { registerSW } from 'virtual:pwa-register';";
assert.ok(coordinatorTypeScript.includes(importLine), 'serviceWorkerUpdate import contract changed');
const transformed = coordinatorTypeScript.replace(importLine, nativeRegisterAdapter());
const coordinatorJavaScript = ts.transpileModule(transformed, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  fileName: 'serviceWorkerUpdate.ts',
}).outputText;

const temporaryRoot = await mkdtemp(join(tmpdir(), 'studycommander-pwa-update-'));
const versions = {
  A: join(temporaryRoot, 'A'),
  B: join(temporaryRoot, 'B'),
};
await writeVersion(versions.A, 'A', coordinatorJavaScript);
await writeVersion(versions.B, 'B', coordinatorJavaScript);

const serverState = { version: 'A', online: true };
const server = createServer(async (request, response) => {
  try {
    if (!serverState.online) {
      response.writeHead(503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      response.end('offline');
      return;
    }
    const url = new URL(request.url ?? '/', BASE_URL);
    if (url.pathname === '/api/compat') {
      const clientVersion = request.headers['x-client-version'];
      if (serverState.version === 'B' && clientVersion === 'A') {
        response.writeHead(409, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ error: 'アプリ更新が必要です。保存済みデータは端末に保持されています', code: 'CLIENT_VERSION_OUTDATED' }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ ok: true, version: serverState.version }));
      return;
    }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
    const filePath = join(versions[serverState.version], relative);
    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': contentType(filePath),
      'Cache-Control': 'no-store',
      ...(relative === 'sw.js' ? { 'Service-Worker-Allowed': '/' } : {}),
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    response.end('not found');
  }
});

let browser;
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  await waitForServer();

  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__PWA_TEST__));
  await page.evaluate(() => window.__PWA_TEST__.ready);
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__PWA_TEST__));
    await page.evaluate(() => window.__PWA_TEST__.ready);
  }

  assert.equal(await page.locator('body').getAttribute('data-build-version'), 'A');
  assert.equal(await page.evaluate(() => window.__PWA_TEST__.versionAsset()), 'A');
  await page.evaluate(() => window.__PWA_TEST__.writeState({ value: 'saved-on-a', sequence: 1 }));
  await page.evaluate(() => window.__PWA_TEST__.setTimer(true));

  serverState.version = 'B';
  assert.equal(await page.evaluate(() => window.__PWA_TEST__.triggerUpdate()), 'installed');
  const notice = page.locator('#service-worker-update-notice');
  await notice.waitFor({ state: 'visible' });
  await assert.doesNotReject(async () => {
    await page.getByRole('button', { name: /操作終了後に更新できます/ }).waitFor({ state: 'visible' });
  });
  assert.equal(await page.getByRole('button', { name: /操作終了後に更新できます/ }).isDisabled(), true);
  assert.match(await notice.textContent(), /タイマー計測中/);

  const compatibility = await page.evaluate(() => window.__PWA_TEST__.requestCompatibility());
  assert.equal(compatibility.status, 409);
  assert.equal(compatibility.code, 'CLIENT_VERSION_OUTDATED');
  await page.getByRole('alert').filter({ hasText: 'アプリ更新が必要です' }).waitFor({ state: 'visible' });

  await page.evaluate(() => window.__PWA_TEST__.writeState({ value: 'saved-while-waiting', sequence: 2 }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__PWA_TEST__));
  await page.evaluate(() => window.__PWA_TEST__.ready);
  assert.equal(await page.locator('body').getAttribute('data-build-version'), 'A', 'waiting update must not replace the active app before approval');
  assert.deepEqual(await page.evaluate(() => window.__PWA_TEST__.readState()), { value: 'saved-while-waiting', sequence: 2 });
  await page.locator('#service-worker-update-notice').waitFor({ state: 'visible' });

  await page.evaluate(() => window.__PWA_TEST__.setTimer(false));
  const updateButton = page.getByRole('button', { name: '新しいバージョンへ更新' });
  await updateButton.waitFor({ state: 'visible' });
  assert.equal(await updateButton.isEnabled(), true);
  await updateButton.click();
  await page.waitForFunction(() => document.body.dataset.buildVersion === 'B', null, { timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__PWA_TEST__));
  await page.evaluate(() => window.__PWA_TEST__.ready);

  assert.equal(await page.evaluate(() => window.__PWA_TEST__.versionAsset()), 'B');
  assert.deepEqual(await page.evaluate(() => window.__PWA_TEST__.readState()), { value: 'saved-while-waiting', sequence: 2 });
  assert.equal(await page.evaluate(() => window.__PWA_TEST__.databaseVersion()), 2);
  assert.equal(await page.evaluate(() => window.__PWA_TEST__.readMigration()), 'v2');
  const cacheKeys = await page.evaluate(() => window.__PWA_TEST__.cacheKeys());
  assert.ok(cacheKeys.includes('studycommander-pwa-compat-B'), `new cache missing: ${JSON.stringify(cacheKeys)}`);
  assert.equal(cacheKeys.includes('studycommander-pwa-compat-A'), false, `old cache survived activation: ${JSON.stringify(cacheKeys)}`);

  serverState.online = false;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__PWA_TEST__));
  await page.evaluate(() => window.__PWA_TEST__.ready);
  assert.equal(await page.locator('body').getAttribute('data-build-version'), 'B', 'activated version must start from offline cache');
  assert.deepEqual(await page.evaluate(() => window.__PWA_TEST__.readState()), { value: 'saved-while-waiting', sequence: 2 });

  console.log('✅ PWA waiting update, IndexedDB migration, API compatibility, restart, offline cache, and cleanup passed');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(() => resolve()));
  await rm(temporaryRoot, { recursive: true, force: true });
}
