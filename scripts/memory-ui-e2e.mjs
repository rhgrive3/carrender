/** End-to-end verification for the simplified memory-card UX. */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const base = 'http://127.0.0.1:8792/';
let tempDirectory;
let server;
let browser;
let page;
let serverOutput = '';
let failures = 0;

function check(name, condition, detail) {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures += 1; console.error(`  ❌ ${name}`, detail ?? ''); }
}

async function command(program, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve(output) : reject(new Error(`${program} ${args.join(' ')} exited ${code}\n${output}`)));
  });
}

async function waitForServer() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(base); if (response.ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Wrangler Pages did not start\n${serverOutput}`);
}

async function stopServer() {
  if (!server?.pid) return;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill('SIGTERM'); }
  await Promise.race([new Promise((resolve) => server.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 3_000))]);
}

async function waitForAnswerOrResult(answerCount) {
  await Promise.race([
    page.getByText(`回答 ${answerCount}回`, { exact: true }).waitFor(),
    page.getByRole('heading', { name: '学習完了' }).waitFor(),
  ]);
}

async function bottomNavigationLayout() {
  return await page.locator('.bottom-nav').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      parentTag: element.parentElement?.tagName,
      position: style.position,
      runtimePinned: element.getAttribute('data-runtime-pinned'),
      bottom: rect.bottom,
      viewportBottom: window.visualViewport?.height ?? window.innerHeight,
    };
  });
}

async function assertBottomNavigationPinned(label) {
  const layout = await bottomNavigationLayout();
  check(`${label}: body直下`, layout.parentTag === 'BODY', layout);
  check(`${label}: fixed`, layout.position === 'fixed', layout);
  check(`${label}: 実行時ガード管理`, layout.runtimePinned === 'true', layout);
  check(`${label}: 表示viewport下端`, Math.abs(layout.viewportBottom - layout.bottom) <= 1.5, layout);
}

try {
  tempDirectory = await mkdtemp(join(tmpdir(), 'carrender-memory-ui-'));
  const persistence = join(tempDirectory, 'state');
  await mkdir(persistence, { recursive: true });
  await command('npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persistence]);
  const config = await readFile(join(cwd, 'wrangler.toml'), 'utf8');
  const databaseId = /database_id\s*=\s*"([^"]+)"/u.exec(config)?.[1];
  if (!databaseId) throw new Error('D1 database_id not found');
  server = spawn('npx', ['wrangler', 'pages', 'dev', 'dist', `--d1=DB=${databaseId}`, '--ip=127.0.0.1', '--port=8792', `--persist-to=${persistence}`, '--log-level=error', '--show-interactive-dev-session=false'], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const append = (chunk) => { serverOutput = `${serverOutput}${chunk.toString()}`.slice(-30_000); };
  server.stdout.on('data', append); server.stderr.on('data', append);
  await waitForServer();

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1133, height: 744 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  page = await context.newPage();
  const username = `memoryui${process.pid}`.slice(0, 20);
  await page.goto(`${base}?pwa-gate=off`, { waitUntil: 'domcontentloaded' });

  console.log('--- Memory UI: registration and onboarding ---');
  await page.getByRole('radio', { name: '新規登録' }).click();
  await page.getByLabel('ユーザー名').fill(username);
  await page.getByLabel('パスワード', { exact: true }).fill('memory-ui-password');
  const registerResponse = page.waitForResponse((response) => response.url().endsWith('/api/auth/register'));
  await page.getByRole('button', { name: '新規登録して始める' }).click();
  const registered = await registerResponse;
  if (registered.status() !== 201) throw new Error(`registration failed: ${registered.status()} ${await registered.text()}`);
  await page.getByText('目標を教えてください', { exact: true }).waitFor();
  await page.locator('#ob-goal').fill('共通テスト本番');
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

  console.log('--- Shell: permanent bottom navigation contract ---');
  await assertBottomNavigationPinned('初期表示');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(80);
  await assertBottomNavigationPinned('長い画面をスクロール後');
  await page.locator('.bottom-nav').evaluate((element) => {
    element.style.setProperty('position', 'absolute', 'important');
    element.style.setProperty('bottom', '120px', 'important');
  });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForFunction(() => {
    const element = document.querySelector('.bottom-nav');
    if (!(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    return getComputedStyle(element).position === 'fixed'
      && element.dataset.runtimePinned === 'true'
      && Math.abs((window.visualViewport?.height ?? window.innerHeight) - rect.bottom) <= 1.5;
  });
  await assertBottomNavigationPinned('後発の固定解除を復元後');
  await page.setViewportSize({ width: 1133, height: 630 });
  await page.waitForTimeout(120);
  await assertBottomNavigationPinned('iPad表示領域変更後');
  await page.setViewportSize({ width: 744, height: 900 });
  await page.waitForTimeout(120);
  await assertBottomNavigationPinned('縦横切替後');

  console.log('--- Memory UI: simple set and card creation ---');
  await page.getByRole('button', { name: '教材', exact: true }).click();
  await page.getByRole('radio', { name: '暗記カード' }).click();
  await page.getByRole('button', { name: 'セットを作る' }).click();
  const createSetDialog = page.getByRole('dialog', { name: '暗記セットを追加' });
  await createSetDialog.getByLabel('セット名').fill('LEAP 1〜300');
  await createSetDialog.getByRole('button', { name: 'セットを作る' }).click();
  await page.getByText('LEAP 1〜300', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'カード追加' }).click();
  await page.locator('#memory-prompt-0').fill('〜を考慮に入れる');
  await page.locator('#memory-answer-0-0').fill('take A into account');
  await page.getByRole('button', { name: '別の英語を追加' }).click();
  await page.locator('#memory-answer-0-1').fill('allow for A');
  await page.getByRole('button', { name: '例文を追加' }).click();
  await page.getByLabel('例文（任意）').fill('Take the delay into account.');
  await page.getByLabel('和訳（任意）').fill('遅れを考慮に入れてください。');
  await page.getByRole('button', { name: '例文を追加' }).click();
  const exampleInputs = page.getByLabel('例文（任意）');
  const translationInputs = page.getByLabel('和訳（任意）');
  await exampleInputs.nth(1).fill('We must allow for traffic.');
  await translationInputs.nth(1).fill('交通事情を考慮しなければならない。');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('〜を考慮に入れる', { exact: true }).waitFor();
  check('問題作成UIを表示しない', await page.getByText('問題形式・指定表現', { exact: false }).count() === 0);
  const firstCardText = await page.locator('.memory-simple-card-row').first().innerText();
  check('カード行に複数の自然な英語を表示', firstCardText.includes('allow for A'));
  check('カード行に複数例文を表示', firstCardText.includes('Take the delay into account.') && firstCardText.includes('We must allow for traffic.'));
  check('カード行に各例文の和訳を表示', firstCardText.includes('遅れを考慮に入れてください。') && firstCardText.includes('交通事情を考慮しなければならない。'));
  check('作成済みカードに確認済みマークを表示', await page.locator('.memory-simple-card-row').first().getByLabel('確認済み').isVisible());

  console.log('--- Memory UI: one Sense per visible card ---');
  await page.locator('.memory-simple-card-row').first().getByRole('button').first().click();
  await page.getByRole('button', { name: '別の意味を追加' }).click();
  await page.locator('#memory-answer-1-0').fill('account for A');
  await page.locator('#memory-prompt-1').fill('〜を説明する');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('.memory-simple-card-row').nth(1).waitFor();
  check('同じItemの複数Senseを別カードへ分離', await page.locator('.memory-simple-card-row').count() === 2);
  const detailRows = await page.locator('.memory-simple-card-row').allInnerTexts();
  check('巨大な連結カードを作らない', detailRows[0].includes('take A into account') && !detailRows[0].includes('account for A') && detailRows[1].includes('account for A'));
  check('確認済み状態を各カードへ永続表示', await page.getByLabel('確認済み').count() === 2);

  // The split-row case above is covered. Remove the test-only second Sense so
  // the study assertions below deterministically exercise the card with examples.
  await page.locator('.memory-simple-card-row').nth(1).getByRole('button').first().click();
  await page.getByRole('button', { name: '意味2を削除' }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.memory-simple-card-row').length === 1);

  console.log('--- Memory UI: iOS rename and Japanese IME safety ---');
  await page.getByRole('button', { name: 'セットを編集' }).click();
  const editSetDialog = page.getByRole('dialog', { name: '暗記セットを編集' });
  const editSetName = editSetDialog.getByLabel('セット名');
  await editSetName.waitFor();
  await page.locator('#root[inert][aria-hidden="true"]').waitFor();
  check('編集開始時にセット名へフォーカス', await editSetName.evaluate((element) => element === document.activeElement));
  check('ダイアログ表示中は背面UIを操作不能にする', await page.locator('#root').getAttribute('inert') !== null);
  await editSetName.fill('LEAP 必修語');
  check('文字入力後もセット名へフォーカスを維持', await editSetName.evaluate((element) => element === document.activeElement));
  await editSetName.evaluate((element) => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    Object.defineProperty(event, 'isComposing', { value: true });
    element.dispatchEvent(event);
  });
  check('日本語変換中のEscapeで編集画面を閉じない', await editSetDialog.isVisible());
  check('日本語変換中のEscape後も入力内容を保持', await editSetName.inputValue() === 'LEAP 必修語');
  await editSetDialog.getByRole('button', { name: '変更を保存' }).click();
  await page.getByRole('heading', { name: 'LEAP 必修語', exact: true }).waitFor();
  check('セット名変更を詳細画面へ反映', await page.getByRole('heading', { name: 'LEAP 必修語', exact: true }).isVisible());

  console.log('--- Memory UI: minimal setup choices ---');
  await page.getByRole('button', { name: '暗記ホームへ戻る' }).click();
  const setCard = page.locator('.memory-simple-set-card').filter({ hasText: 'LEAP 必修語' });
  await setCard.getByRole('button', { name: '設定' }).click();
  check('方向は日→英と英→日の2種類だけ', await page.getByRole('radiogroup', { name: '出題方向' }).getByRole('radio').count() === 2);
  check('文脈問題とミックスを削除', await page.getByText('文中で使う', { exact: true }).count() === 0 && await page.getByText('ミックス', { exact: true }).count() === 0);
  await page.getByRole('button', { name: '暗記ホームへ戻る' }).click();

  console.log('--- Memory UI: three-action flashcard study ---');
  await setCard.getByRole('button', { name: '10問始める' }).click();
  await page.locator('.memory-study-overlay').waitFor();
  check('学習画面に入力欄を出さない', await page.locator('.memory-study-card input, .memory-study-card textarea').count() === 0);
  await page.getByRole('button', { name: '答えを見る' }).click();
  check('自己評価は3択だけ', await page.locator('.memory-simple-assessment button').count() === 3);
  const answerFace = page.getByRole('button', { name: '問題に戻る' });
  check('学習画面でも複数例文を表示', await answerFace.getByText('Take the delay into account.', { exact: true }).isVisible() && await answerFace.getByText('We must allow for traffic.', { exact: true }).isVisible());
  check('学習画面でも各和訳を表示', await answerFace.getByText('遅れを考慮に入れてください。', { exact: true }).isVisible() && await answerFace.getByText('交通事情を考慮しなければならない。', { exact: true }).isVisible());
  await page.getByRole('button', { name: 'まだ' }).click();
  let answerCount = 1;
  await waitForAnswerOrResult(answerCount);

  for (let guard = 0; guard < 12; guard += 1) {
    if (await page.getByRole('heading', { name: '学習完了' }).isVisible().catch(() => false)) break;
    await page.getByRole('button', { name: '答えを見る' }).click();
    await page.getByRole('button', { name: '覚えた' }).click();
    answerCount += 1;
    await waitForAnswerOrResult(answerCount);
  }
  await page.getByRole('heading', { name: '学習完了' }).waitFor();
  check('結果画面から苦手分析導線を削除', await page.locator('.memory-result-actions').getByRole('button', { name: /分析/ }).count() === 0);
  check('新しい結果ラベルを表示', await page.getByText('あやしい', { exact: true }).isVisible());

  console.log(failures === 0 ? '\n🎉 ALL PASS (memory simple UI E2E)' : `\n💥 ${failures} FAILURES (memory simple UI E2E)`);
} catch (error) {
  failures += 1;
  console.error(error);
} finally {
  if (browser) await browser.close();
  await stopServer();
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
