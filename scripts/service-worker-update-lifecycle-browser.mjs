import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/serviceWorkerUpdate.ts', import.meta.url), 'utf8');
const adapter = `
const registerSW = (options) => {
  window.__needRefresh = () => options.onNeedRefresh();
  return async () => {
    window.__updateCalls = (window.__updateCalls || 0) + 1;
    if (window.__rejectUpdate) throw new Error('activation failed');
  };
};`;
const transformed = source.replace("import { registerSW } from 'virtual:pwa-register';", adapter)
  .replace('export function registerSafeServiceWorkerUpdate', 'function registerSafeServiceWorkerUpdate')
  .replace('export function serviceWorkerUpdateBlockers', 'function serviceWorkerUpdateBlockers')
  .replace('export function applyCriticalServiceWorkerUpdate', 'function applyCriticalServiceWorkerUpdate')
  + '\nwindow.__registerUpdate = registerSafeServiceWorkerUpdate;';
const javascript = ts.transpileModule(transformed, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;

const root = await mkdtemp(join(tmpdir(), 'sw-update-lifecycle-'));
await writeFile(join(root, 'module.js'), javascript);
const server = createServer(async (request, response) => {
  const path = request.url === '/module.js' ? join(root, 'module.js') : null;
  response.writeHead(200, { 'Content-Type': path ? 'text/javascript' : 'text/html' });
  response.end(path ? await readFile(path) : '<!doctype html><body><main id="app"></main><script type="module" src="/module.js"></script></body>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.waitForFunction(() => typeof window.__registerUpdate === 'function');
  await page.evaluate(() => {
    window.__unhandledRejectionCount = 0;
    window.addEventListener('unhandledrejection', (event) => {
      window.__unhandledRejectionCount += 1;
      event.preventDefault();
    });
    window.__registerUpdate();
    const blocker = document.createElement('div');
    blocker.className = 'memory-editor';
    document.body.appendChild(blocker);
    window.__needRefresh();
  });
  await page.waitForSelector('#service-worker-update-notice');
  const initialHtml = await page.locator('#service-worker-update-notice').evaluate((node) => node.innerHTML);
  let noticeMutations = 0;
  await page.exposeFunction('__noticeMutation', () => { noticeMutations += 1; });
  await page.evaluate(() => {
    const notice = document.getElementById('service-worker-update-notice');
    const observer = new MutationObserver(() => window.__noticeMutation());
    observer.observe(notice, { childList: true, subtree: true, attributes: true });
    window.__testObserver = observer;
  });
  await page.waitForTimeout(2_300);
  assert.equal(await page.locator('#service-worker-update-notice').evaluate((node) => node.innerHTML), initialHtml, 'steady state must keep the same notice DOM');
  assert.equal(noticeMutations, 0, 'notice subtree must not be rewritten by its own observer/timer');

  await page.evaluate(() => document.querySelector('.memory-editor')?.remove());
  await page.waitForFunction(() => document.querySelector('#service-worker-update-notice button')?.disabled === false);
  await page.evaluate(() => { window.__rejectUpdate = true; });
  await page.locator('#service-worker-update-notice button').click();
  await page.waitForFunction(() => document.querySelector('#service-worker-update-notice')?.getAttribute('role') === 'alert');
  assert.match(await page.locator('#service-worker-update-notice').innerText(), /更新を適用できませんでした。activation failed/);
  assert.equal(await page.locator('#service-worker-update-notice button').isEnabled(), true, 'failed update must restore a retry button');
  assert.equal(await page.locator('#service-worker-update-notice button').innerText(), '更新を再試行');
  assert.equal(await page.evaluate(() => window.__updateCalls), 1);

  await page.evaluate(() => { window.__rejectUpdate = false; });
  await page.locator('#service-worker-update-notice button').click();
  await page.waitForFunction(() => window.__updateCalls === 2);
  assert.equal(await page.locator('#service-worker-update-notice button').innerText(), '更新中…');
  assert.equal(await page.locator('#service-worker-update-notice button').isDisabled(), true);
  assert.equal(await page.evaluate(() => window.__unhandledRejectionCount || 0), 0);
  console.log('✅ service worker update notice is quiescent and recovers from activation failure');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
