/** WebKit regression for synchronous pagehide emergency-cache recovery. */
import { spawn } from 'node:child_process';
import { webkit } from 'playwright';

const cwd = new URL('..', import.meta.url).pathname;
const base = 'http://127.0.0.1:4184/';
let server;
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
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Vite did not become ready\n${output}`);
}

try {
  server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4184', '--strictPort'], {
    cwd,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const append = (chunk) => { output = `${output}${chunk.toString()}`.slice(-20_000); };
  server.stdout.on('data', append);
  server.stderr.on('data', append);
  await waitForServer();

  browser = await webkit.launch();
  const context = await browser.newContext({ viewport: { width: 834, height: 1194 } });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(async () => {
    const {
      getEmergencyStateCacheStatus,
      persistEmergencyStateCache,
      resetEmergencyStateCacheStatus,
      subscribeEmergencyStateCacheStatus,
    } = await import('/src/lib/emergencyStateCache.ts');
    const { EMERGENCY_CACHE_MAX_CHARS } = await import('/src/lib/storage.ts');

    resetEmergencyStateCacheStatus();
    localStorage.clear();
    const phases = [];
    const unsubscribe = subscribeEmergencyStateCacheStatus((status) => phases.push(status.phase));
    const small = { payload: 'webkit-pagehide' };
    const oversized = { payload: 'x'.repeat(EMERGENCY_CACHE_MAX_CHARS + 1) };

    persistEmergencyStateCache(oversized);
    const suppressed = getEmergencyStateCacheStatus();

    const pagehideHandler = () => persistEmergencyStateCache(small);
    window.addEventListener('pagehide', pagehideHandler, { once: true });
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    const afterPagehide = getEmergencyStateCacheStatus();
    const pagehideSnapshot = localStorage.getItem('studycommander_state_v1');

    persistEmergencyStateCache(oversized);
    const visibilityHandler = () => persistEmergencyStateCache(small);
    document.addEventListener('visibilitychange', visibilityHandler, { once: true });
    document.dispatchEvent(new Event('visibilitychange'));
    const afterVisibility = getEmergencyStateCacheStatus();

    unsubscribe();
    return { suppressed, afterPagehide, afterVisibility, pagehideSnapshot, phases };
  });

  if (result.suppressed.phase !== 'suppressed') throw new Error(`suppression missing: ${JSON.stringify(result)}`);
  if (result.afterPagehide.phase !== 'active') throw new Error(`pagehide did not recover: ${JSON.stringify(result)}`);
  if (result.pagehideSnapshot !== JSON.stringify({ payload: 'webkit-pagehide' })) throw new Error('pagehide snapshot missing');
  if (result.afterVisibility.phase !== 'active') throw new Error(`visibility did not recover: ${JSON.stringify(result)}`);
  if (!result.phases.includes('retrying')) throw new Error(`retrying phase missing: ${JSON.stringify(result.phases)}`);
  console.log('✅ WebKit pagehide/visibility emergency-cache regression passed');
} finally {
  await browser?.close();
  if (server?.pid) {
    try {
      if (process.platform === 'win32') server.kill('SIGTERM');
      else process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
  }
}
