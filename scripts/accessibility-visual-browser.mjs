import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const base = 'http://127.0.0.1:8796/';
const artifacts = join(cwd, 'artifacts', 'accessibility-visual');
let tempDirectory;
let server;
let serverOutput = '';

async function command(program, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve(output)
      : reject(new Error(`${program} ${args.join(' ')} exited ${code}\n${output}`)));
  });
}

async function waitForServer() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {
      // starting
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Wrangler Pages did not start\n${serverOutput}`);
}

async function stopServer() {
  if (!server?.pid) return;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill('SIGTERM'); }
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
}

async function auditDom(page, label) {
  const result = await page.evaluate(() => {
    const ids = new Map();
    document.querySelectorAll('[id]').forEach((element) => {
      const id = element.id;
      ids.set(id, (ids.get(id) ?? 0) + 1);
    });
    const duplicateIds = [...ids.entries()].filter(([, count]) => count > 1);

    const invalidReferences = [];
    for (const element of document.querySelectorAll('[aria-controls], [aria-labelledby], [aria-describedby]')) {
      for (const attribute of ['aria-controls', 'aria-labelledby', 'aria-describedby']) {
        const raw = element.getAttribute(attribute);
        if (!raw) continue;
        for (const id of raw.trim().split(/\s+/)) {
          if (id && !document.getElementById(id)) {
            invalidReferences.push({ tag: element.tagName, attribute, id });
          }
        }
      }
    }

    const hiddenFocusable = [];
    const focusableSelector = 'a[href], button, input, select, textarea, [tabindex]';
    document.querySelectorAll(focusableSelector).forEach((element) => {
      if (!(element instanceof HTMLElement) || element.tabIndex < 0 || element.hasAttribute('disabled')) return;
      if (element.closest('[inert]')) return;
      const hiddenAncestor = element.closest('[hidden], [aria-hidden="true"]');
      if (hiddenAncestor) hiddenFocusable.push({ tag: element.tagName, text: element.textContent?.trim().slice(0, 60) ?? '' });
    });

    const nav = document.querySelector('.bottom-nav');
    let navigation = null;
    if (nav instanceof HTMLElement) {
      const rect = nav.getBoundingClientRect();
      const viewportBottom = window.visualViewport
        ? window.visualViewport.offsetTop + window.visualViewport.height
        : window.innerHeight;
      navigation = {
        position: getComputedStyle(nav).position,
        bottomDelta: Math.abs(viewportBottom - rect.bottom),
        parent: nav.parentElement?.tagName ?? null,
        runtimePinned: nav.dataset.runtimePinned ?? null,
      };
    }

    const horizontalOverflow = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { duplicateIds, invalidReferences, hiddenFocusable, navigation, horizontalOverflow };
  });

  assert.deepEqual(result.duplicateIds, [], `${label}: duplicate IDを作らない`);
  assert.deepEqual(result.invalidReferences, [], `${label}: ARIA参照先を失わない`);
  assert.deepEqual(result.hiddenFocusable, [], `${label}: hidden領域へfocusable要素を残さない`);
  assert.ok(result.horizontalOverflow <= 2, `${label}: viewport外への横溢れを作らない (${result.horizontalOverflow}px)`);
  if (result.navigation) {
    assert.equal(result.navigation.parent, 'BODY', `${label}: 下部ナビはbody直下`);
    assert.equal(result.navigation.position, 'fixed', `${label}: 下部ナビはfixed`);
    assert.equal(result.navigation.runtimePinned, 'true', `${label}: 下部ナビ固定ガードが有効`);
    assert.ok(result.navigation.bottomDelta <= 1.5, `${label}: 下部ナビは表示viewport下端`);
  }
}

async function registerAndOnboard(page) {
  const username = `a11y${process.pid}${Date.now()}`.slice(0, 20);
  await page.goto(`${base}?pwa-gate=off`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('radio', { name: '新規登録' }).click();
  await page.getByLabel('ユーザー名').fill(username);
  await page.getByLabel('パスワード', { exact: true }).fill('a11y-visual-password');
  await page.getByLabel('パスワード（確認）').fill('a11y-visual-password');
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/auth/register'));
  await page.getByRole('button', { name: '新規登録して始める' }).click();
  const response = await responsePromise;
  if (response.status() !== 201) throw new Error(`registration failed: ${response.status()} ${await response.text()}`);

  await page.getByText('目標を教えてください', { exact: true }).waitFor();
  await page.locator('#ob-goal').fill('アクセシビリティ監査');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.getByRole('button', { name: '数学', exact: true }).click();
  await page.getByRole('button', { name: '英語', exact: true }).click();
  await page.getByRole('button', { name: '次へ(2科目)', exact: true }).click();
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.getByRole('button', { name: '教材を追加', exact: true }).click();
  await page.locator('#ob-mname-0').fill('数学基礎問題集');
  await page.locator('#ob-mtotal-0').fill('30');
  await page.getByRole('button', { name: '計画を自動生成する', exact: true }).click();
  await page.locator('.bottom-nav').waitFor({ timeout: 30_000 });
}

async function screenshotAndAudit(page, name) {
  await page.waitForTimeout(100);
  await auditDom(page, name);
  await page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true, animations: 'disabled' });
}

try {
  await mkdir(artifacts, { recursive: true });
  tempDirectory = await mkdtemp(join(tmpdir(), 'carrender-a11y-visual-'));
  const persistence = join(tempDirectory, 'state');
  await mkdir(persistence, { recursive: true });
  await command('npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persistence]);
  const config = await readFile(join(cwd, 'wrangler.toml'), 'utf8');
  const databaseId = /database_id\s*=\s*"([^"]+)"/u.exec(config)?.[1];
  if (!databaseId) throw new Error('D1 database_id not found');

  server = spawn('npx', [
    'wrangler', 'pages', 'dev', 'dist', `--d1=DB=${databaseId}`,
    '--ip=127.0.0.1', '--port=8796', `--persist-to=${persistence}`,
    '--log-level=error', '--show-interactive-dev-session=false',
  ], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const append = (chunk) => { serverOutput = `${serverOutput}${chunk.toString()}`.slice(-30_000); };
  server.stdout.on('data', append);
  server.stderr.on('data', append);
  await waitForServer();

  const browser = await chromium.launch();
  try {
    const bootstrapContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
      reducedMotion: 'reduce',
    });
    const bootstrapPage = await bootstrapContext.newPage();
    await registerAndOnboard(bootstrapPage);
    await screenshotAndAudit(bootstrapPage, 'iphone-portrait-home');

    await bootstrapPage.getByRole('button', { name: '記録', exact: true }).click();
    await screenshotAndAudit(bootstrapPage, 'iphone-portrait-records');

    await bootstrapPage.getByRole('button', { name: '教材', exact: true }).click();
    await screenshotAndAudit(bootstrapPage, 'iphone-portrait-materials');
    await bootstrapPage.getByRole('button', { name: '教材を追加', exact: true }).click();
    const dialog = bootstrapPage.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(await bootstrapPage.locator('#root').getAttribute('inert') !== null, true, 'Sheet表示中は背面をinertにする');
    assert.equal(await bootstrapPage.locator('#root').getAttribute('aria-hidden'), 'true', 'Sheet表示中は背面を読み上げ対象外にする');
    await screenshotAndAudit(bootstrapPage, 'iphone-portrait-material-sheet');
    await dialog.getByRole('button', { name: /閉じる|キャンセル/ }).first().click();

    const storageState = await bootstrapContext.storageState();
    await bootstrapContext.close();

    const variants = [
      { name: 'iphone-landscape', viewport: { width: 844, height: 390 } },
      { name: 'ipad-portrait', viewport: { width: 820, height: 1180 } },
      { name: 'ipad-landscape', viewport: { width: 1180, height: 820 } },
    ];
    for (const variant of variants) {
      const context = await browser.newContext({
        storageState,
        viewport: variant.viewport,
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      await page.goto(`${base}?pwa-gate=off`, { waitUntil: 'domcontentloaded' });
      await page.locator('.bottom-nav').waitFor({ timeout: 30_000 });
      await screenshotAndAudit(page, `${variant.name}-home`);
      await context.close();
    }

    const zoomContext = await browser.newContext({ storageState, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const zoomPage = await zoomContext.newPage();
    await zoomPage.goto(`${base}?pwa-gate=off`, { waitUntil: 'domcontentloaded' });
    await zoomPage.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await screenshotAndAudit(zoomPage, 'iphone-text-zoom-200');
    await zoomContext.close();

    const forcedContext = await browser.newContext({
      storageState,
      viewport: { width: 820, height: 1180 },
      reducedMotion: 'reduce',
      forcedColors: 'active',
    });
    const forcedPage = await forcedContext.newPage();
    await forcedPage.goto(`${base}?pwa-gate=off`, { waitUntil: 'domcontentloaded' });
    await screenshotAndAudit(forcedPage, 'ipad-forced-colors');
    await forcedContext.close();
  } finally {
    await browser.close();
  }

  console.log(`✅ accessibility visual audit passed; screenshots=${artifacts}`);
} finally {
  await stopServer();
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
}
