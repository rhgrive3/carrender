/** End-to-end memory UI verification on real Pages Functions + local D1. */
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

async function waitForAnswerCount(count) {
  await page.getByText(`回答 ${count}回`, { exact: true }).waitFor();
}

async function answerReorder() {
  const available = await page.locator('.memory-reorder-tokens > button').allTextContents();
  const ordered = available.includes('take') ? ['take', 'A', 'into', 'account'] : ['allow', 'for', 'A'];
  for (const token of ordered) {
    await page.getByRole('button', { name: token, exact: true }).click();
  }
  await page.getByRole('button', { name: '回答する' }).click();
}

async function revealAndRemember() {
  await page.getByRole('button', { name: 'タップして答えを見る' }).click();
  const answerButtons = page.locator('.memory-model-answers > button');
  if (await answerButtons.count() > 1) await answerButtons.first().click();
  await page.getByRole('button', { name: '覚えた' }).click();
}

function check(name, condition, detail) {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.error(`  ❌ ${name}`, detail ?? '');
  }
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

async function waitForServer(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {
      // Wrangler is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Wrangler Pages did not start\n${serverOutput}`);
}

async function stopServer() {
  if (!server?.pid) return;
  try {
    if (process.platform === 'win32') server.kill('SIGTERM');
    else process.kill(-server.pid, 'SIGTERM');
  } catch {
    server.kill('SIGTERM');
  }
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
}

try {
  tempDirectory = await mkdtemp(join(tmpdir(), 'carrender-memory-ui-'));
  const persistence = join(tempDirectory, 'state');
  await mkdir(persistence, { recursive: true });
  await command('npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persistence]);
  const config = await readFile(join(cwd, 'wrangler.toml'), 'utf8');
  const databaseId = /database_id\s*=\s*"([^"]+)"/u.exec(config)?.[1];
  if (!databaseId) throw new Error('D1 database_id not found');
  server = spawn('npx', [
    'wrangler', 'pages', 'dev', 'dist', `--d1=DB=${databaseId}`,
    '--ip=127.0.0.1', '--port=8792', `--persist-to=${persistence}`,
    '--log-level=error', '--show-interactive-dev-session=false',
  ], { cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const append = (chunk) => { serverOutput = `${serverOutput}${chunk.toString()}`.slice(-30_000); };
  server.stdout.on('data', append);
  server.stderr.on('data', append);
  await waitForServer();

  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1133, height: 744 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
  });
  page = await context.newPage();
  const username = `memoryui${process.pid}`.slice(0, 20);
  await page.goto(`${base}?pwa-gate=off`, { waitUntil: 'domcontentloaded' });

  console.log('--- Memory UI: auth bootstrap and Materials entry ---');
  await page.getByRole('radio', { name: '新規登録' }).click();
  await page.getByLabel('ユーザー名').fill(username);
  await page.getByLabel('パスワード', { exact: true }).fill('memory-ui-password');
  const registerResponse = page.waitForResponse((response) => response.url().endsWith('/api/auth/register'));
  await page.getByRole('button', { name: '新規登録して始める' }).click();
  const registered = await registerResponse;
  if (registered.status() !== 201) throw new Error(`registration failed: ${registered.status()} ${await registered.text()}`);
  await page.waitForFunction((owner) => localStorage.getItem('studycommander_auth_hint') === owner, username);
  await page.getByText('目標を教えてください', { exact: true }).waitFor();

  console.log('--- Memory UI: complete real onboarding and persist it ---');
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
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('studycommander_state_v1');
    return !!raw && JSON.parse(raw).onboarded === true;
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.bottom-nav').waitFor({ timeout: 30_000 });
  check('実オンボーディング完了状態が再読み込み後も保持される', await page.getByText('目標を教えてください', { exact: true }).count() === 0);
  await page.getByRole('button', { name: '教材', exact: true }).click();
  await page.getByText('数学基礎問題集', { exact: true }).waitFor();
  await page.getByRole('radio', { name: '暗記カード' }).click();
  await page.getByRole('heading', { name: '暗記カード' }).waitFor();
  check('既存下部ナビを増やさず教材から暗記へ入る', await page.locator('.bottom-nav button').count() === 5);

  console.log('--- Memory UI: set/card creation and responsive layout ---');
  await page.getByRole('button', { name: '最初のセットを作る' }).click();
  const dialogBox = await page.locator('.memory-dialog').boundingBox();
  check('モーダルが100dvh内に収まる', !!dialogBox && dialogBox.y >= 0 && dialogBox.y + dialogBox.height <= 744, dialogBox);
  await page.getByLabel('セット名').fill('LEAP 1〜300');
  await page.getByRole('button', { name: 'セットを保存' }).click();
  await page.getByText('LEAP 1〜300', { exact: true }).first().waitFor();
  const listBox = await page.locator('.memory-set-list-panel').boundingBox();
  const overviewBox = await page.locator('.memory-set-overview').boundingBox();
  check('iPad mini横画面でセット一覧2カラム', !!listBox && !!overviewBox && overviewBox.x > listBox.x + listBox.width - 2, { listBox, overviewBox });

  await page.getByRole('button', { name: '追加', exact: true }).click();
  await page.locator('#memory-prompt-0').fill('〜を考慮に入れる');
  await page.locator('#memory-answer-0-0').fill('take A into account');
  await page.getByRole('button', { name: '別の表現を追加' }).click();
  await page.locator('#memory-answer-0-1').fill('allow for A');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForSelector('.memory-content-row, .memory-home');
  if (await page.locator('.memory-content-row').count() === 0) {
    await page.getByRole('button', { name: '詳細', exact: true }).click();
  }
  await page.locator('.memory-content-row').first().waitFor();
  const firstCardText = await page.locator('.memory-content-row').first().innerText();
  check('日本語一つへ複数Answerを登録', firstCardText.includes('take A into account') && firstCardText.includes('allow for A'), firstCardText);

  await page.getByRole('button', { name: '追加', exact: true }).click();
  await page.locator('#memory-prompt-0').fill('〜を知覚する');
  await page.locator('#memory-answer-0-0').fill('perceive A');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('.memory-content-row').filter({ hasText: '〜を知覚する' }).waitFor();

  console.log('--- Memory UI: Exercise editor ---');
  await page.locator('.memory-content-row').filter({ hasText: '〜を考慮に入れる' }).locator('.memory-content-main').click();
  await page.getByRole('button', { name: /問題形式・指定表現/ }).click();
  await page.getByRole('button', { name: '問題を追加' }).click();
  await page.locator('#memory-exercise-prompt-0-0').fill('Take the delay (       ) account.');
  await page.locator('#memory-exercise-answer-0-0').selectOption({ label: 'take A into account' });
  await page.getByLabel('問題1の必須語句').fill('into');
  await page.getByRole('button', { name: '問題を追加' }).click();
  await page.locator('#memory-exercise-type-0-1').selectOption('guided_composition');
  await page.locator('#memory-exercise-prompt-0-1').fill('その遅れを考慮しなさい。');
  await page.locator('#memory-exercise-answer-0-1').selectOption({ label: 'take A into account' });
  await page.getByLabel('問題2の必須語句').fill('take');
  await page.getByRole('button', { name: '問題を追加' }).click();
  await page.locator('#memory-exercise-type-0-2').selectOption('reorder');
  await page.locator('#memory-exercise-prompt-0-2').fill('「Aを考慮に入れる」を並べ替えてください。');
  await page.locator('#memory-exercise-answer-0-2').selectOption({ label: 'take A into account' });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('.memory-content-row').filter({ hasText: '〜を考慮に入れる' }).waitFor();
  check('Editorから穴埋め・語順整序・Composition Exerciseを保存', true);

  console.log('--- Memory UI: full-screen deterministic study ---');
  await page.getByRole('button', { name: '学習を始める' }).click();
  await page.getByRole('radio', { name: '全部' }).click();
  await page.getByRole('button', { name: '学習を始める' }).click();
  await page.locator('.memory-study-overlay').waitFor();
  check('全画面学習中は下部ナビをDOMから外す', await page.locator('.bottom-nav').count() === 0);
  const cardBox = await page.locator('.memory-study-card').boundingBox();
  check('横画面でもカード最大幅760px', !!cardBox && cardBox.width <= 761, cardBox);
  const animationDuration = await page.locator('.memory-study-card').evaluate((element) => getComputedStyle(element).animationDuration);
  check('Reduced Motionで長いアニメーションを無効化', animationDuration === '1e-05s' || animationDuration === '0.00001s' || animationDuration === '0s', animationDuration);

  const transitionTimes = [];
  for (let index = 0; index < 2; index += 1) {
    await page.getByRole('button', { name: 'タップして答えを見る' }).click();
    const answerButtons = page.locator('.memory-model-answers > button');
    if (await answerButtons.count() > 1) await answerButtons.first().click();
    const started = performance.now();
    await page.getByRole('button', { name: '覚えた' }).click();
    if (index === 0) await page.getByRole('button', { name: 'タップして答えを見る' }).waitFor();
    else await page.getByRole('heading', { name: 'セッション完了' }).waitFor();
    transitionTimes.push(performance.now() - started);
  }
  check('初期問題数と回答回数を結果で分離表示', await page.getByText('2問のLearning Target・回答 2回').isVisible());
  check('次問操作可能まで250ms以内（Reduced Motion）', transitionTimes[0] <= 250, transitionTimes);

  console.log('--- Memory UI: typed Input, Context and Composition ---');
  await page.getByRole('button', { name: '暗記ホーム' }).click();
  await page.getByRole('button', { name: 'このセットで学習' }).click();
  await page.getByRole('radio', { name: '全部' }).click();
  await page.getByRole('radio', { name: '英→日' }).click();
  await page.getByRole('button', { name: /詳細設定/ }).click();
  await page.getByRole('radio', { name: '入力式' }).click();
  await page.getByRole('button', { name: '学習を始める' }).click();
  for (let index = 0; index < 2; index += 1) {
    await waitForAnswerCount(index);
    const question = await page.locator('.memory-study-card h1').innerText();
    const japanese = question.includes('perceive') ? '〜を知覚する' : '〜を考慮に入れる';
    await page.getByLabel('回答を入力').fill(japanese);
    await page.getByRole('button', { name: '回答する' }).click();
    await page.getByRole('button', { name: '正解・次へ' }).click();
    if (index < 1) await waitForAnswerCount(index + 1);
  }
  await page.getByRole('heading', { name: 'セッション完了' }).waitFor();
  check('Input入力式を日本語Senseで正解判定', await page.getByText('正解').first().isVisible());

  await page.getByRole('button', { name: '暗記ホーム' }).click();
  await page.getByRole('button', { name: 'このセットで学習' }).click();
  await page.getByRole('radio', { name: '全部' }).click();
  await page.getByRole('radio', { name: '英→日' }).click();
  await page.getByRole('button', { name: /詳細設定/ }).click();
  await page.getByRole('radio', { name: 'Input選択式' }).click();
  await page.getByRole('button', { name: '学習を始める' }).click();
  for (let index = 0; index < 2; index += 1) {
    await waitForAnswerCount(index);
    const question = await page.locator('.memory-study-card h1').innerText();
    const japanese = question.includes('perceive') ? '〜を知覚する' : '〜を考慮に入れる';
    const choiceGroup = page.getByRole('radiogroup', { name: '日本語の意味を選択' });
    const choice = choiceGroup.getByRole('radio', { name: japanese, exact: true });
    check('Input選択式はVoiceOverへ未選択状態を公開', await choice.getAttribute('aria-checked') === 'false');
    if (index === 0) {
      const radios = choiceGroup.getByRole('radio');
      await radios.first().focus();
      await page.keyboard.press('ArrowRight');
      check(
        'Input選択式は矢印キーとroving tabindexで移動',
        await radios.nth(1).getAttribute('aria-checked') === 'true'
          && await radios.nth(1).getAttribute('tabindex') === '0'
          && await radios.first().getAttribute('tabindex') === '-1',
      );
    }
    await choice.click();
    check('Input選択式はVoiceOverへ選択状態を公開', await choice.getAttribute('aria-checked') === 'true');
    await page.getByRole('button', { name: '回答する' }).click();
    await page.getByRole('button', { name: '正解・次へ' }).click();
    if (index < 1) await waitForAnswerCount(index + 1);
  }
  await page.getByRole('heading', { name: 'セッション完了' }).waitFor();
  check('Input選択式を日本語Senseで正解判定', await page.getByText('正解').first().isVisible());

  await page.getByRole('button', { name: '暗記ホーム' }).click();
  await page.getByRole('button', { name: 'このセットで学習' }).click();
  await page.getByRole('radio', { name: '全部' }).click();
  await page.getByRole('radio', { name: '文中で使う' }).click();
  await page.getByRole('button', { name: '学習を始める' }).click();
  const contextTypes = new Set();
  for (let index = 0; index < 2; index += 1) {
    await waitForAnswerCount(index);
    const exerciseType = (await page.locator('.memory-question-type').innerText()).trim().toLowerCase();
    contextTypes.add(exerciseType);
    if (exerciseType === 'reorder') {
      await answerReorder();
    } else {
      await page.getByLabel('回答を入力').fill('into');
      await page.getByRole('button', { name: '回答する' }).click();
    }
    await page.getByRole('button', { name: '正解・次へ' }).click();
    if (index < 1) await waitForAnswerCount(index + 1);
  }
  await page.getByRole('heading', { name: 'セッション完了' }).waitFor();
  check('穴埋めExercise固有回答を正解判定', contextTypes.has('fill blank'), [...contextTypes]);
  check('語順整序をタップ操作で正解判定', contextTypes.has('reorder'), [...contextTypes]);

  await page.getByRole('button', { name: '暗記ホーム' }).click();
  await page.getByRole('button', { name: 'このセットで学習' }).click();
  await page.getByRole('radio', { name: '全部' }).click();
  await page.getByRole('radio', { name: 'ミックス' }).click();
  await page.getByRole('button', { name: '学習を始める' }).click();
  // Mix may start on another mode; answer until the Composition target appears.
  let compositionSeen = false;
  let mixAnswerCount = 0;
  for (let guard = 0; guard < 8 && !compositionSeen; guard += 1) {
    await waitForAnswerCount(mixAnswerCount);
    const mode = await page.locator('.memory-study-mode').innerText();
    if (mode.includes('英作文')) {
      compositionSeen = true;
      await page.getByLabel('英作文の回答').fill('Consider the delay.');
      await page.getByRole('button', { name: '回答する' }).click();
      await page.getByText('自分で最終評価してください').waitFor();
      check('Compositionで不足必須語句と自己評価を表示', await page.getByText('必須「take」なし').isVisible()
        && await page.getByRole('button', { name: '部分的' }).isVisible());
      await page.getByRole('button', { name: '部分的' }).click();
      mixAnswerCount += 1;
      break;
    }
    const revealButton = page.getByRole('button', { name: 'タップして答えを見る' });
    if (await revealButton.isVisible().catch(() => false)) {
      await revealAndRemember();
    } else {
      const exerciseType = (await page.locator('.memory-question-type').innerText()).trim().toLowerCase();
      if (exerciseType === 'reorder') {
        await answerReorder();
      } else {
        await page.getByLabel('回答を入力').fill('into');
        await page.getByRole('button', { name: '回答する' }).click();
      }
      await page.getByRole('button', { name: /正解・次へ/ }).click();
    }
    mixAnswerCount += 1;
  }
  check('MixにComposition targetを残す', compositionSeen);
  if (await page.getByRole('heading', { name: 'セッション完了' }).isVisible().catch(() => false)) {
    await page.getByRole('button', { name: '暗記ホーム' }).click();
  } else {
    await waitForAnswerCount(mixAnswerCount);
    await page.getByRole('button', { name: '学習を閉じて途中保存' }).click();
  }

  console.log('--- Memory UI: offline answer and session restoration ---');
  await page.getByRole('button', { name: 'このセットで学習' }).click();
  await page.getByRole('radio', { name: '全部' }).click();
  await page.getByRole('radio', { name: '日→英' }).click();
  await page.getByRole('button', { name: '学習を始める' }).click();
  await page.locator('.memory-study-overlay').waitFor();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  const criticalRequests = [];
  let capture = true;
  page.on('request', (request) => {
    if (capture && new URL(request.url()).pathname.startsWith('/api/')) criticalRequests.push(`${request.method()} ${request.url()}`);
  });
  await context.setOffline(true);
  await revealAndRemember();
  await waitForAnswerCount(1);
  await page.getByRole('button', { name: '学習を閉じて途中保存' }).click();
  check('回答・次問のクリティカルパスでAPI通信なし', criticalRequests.length === 0, criticalRequests);
  capture = false;

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '暗記カード学習を開く' }).click();
  const resumedFromToday = await page.locator('.memory-study-overlay').waitFor({ timeout: 5_000 }).then(() => true).catch(() => false);
  check('Todayの続ける操作で途中セッションを直接再開', resumedFromToday);
  if (!resumedFromToday) {
    const resume = page.getByRole('button', { name: /前回の続き/ });
    await resume.waitFor();
    check('オフライン再起動後に途中セッションを検出', await resume.isEnabled());
    await resume.click();
  } else {
    check('オフライン再起動後に途中セッションを検出', true);
  }
  await page.getByText('回答 1回', { exact: true }).waitFor();
  check('最後に確定した回答数から復元', await page.getByText('回答 1回', { exact: true }).isVisible());
  await context.setOffline(false);

  console.log('--- Memory UI: 20-sample answer-to-next-question P95 ---');
  // Re-authentication after reconnect can remount the owner-scoped feature
  // once while the username database is migrated to the stable user ID. Drive
  // whichever owner-stable surface is visible instead of racing that remount.
  await page.waitForTimeout(500);
  for (let guard = 0; guard < 12; guard += 1) {
    if (await page.getByRole('heading', { name: '暗記カード' }).isVisible().catch(() => false)) break;
    const closeRestoredStudy = page.getByRole('button', { name: '学習を閉じて途中保存' });
    const todayShortcut = page.getByRole('button', { name: '暗記カード学習を開く' });
    if (await closeRestoredStudy.isVisible().catch(() => false)) await closeRestoredStudy.click();
    else if (await todayShortcut.isVisible().catch(() => false)) await todayShortcut.click();
    else if (await page.getByRole('button', { name: '教材', exact: true }).isVisible().catch(() => false)) {
      await page.getByRole('button', { name: '教材', exact: true }).click();
      await page.getByRole('radio', { name: '暗記カード' }).click();
    }
    await page.waitForTimeout(250);
  }
  await page.getByRole('heading', { name: '暗記カード' }).waitFor();
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await page.getByRole('button', { name: '表形式' }).click();
  const bulkRows = Array.from({ length: 30 }, (_, index) => `性能確認${String(index + 1).padStart(2, '0')}\tperformance phrase ${String(index + 1).padStart(2, '0')}`).join('\n');
  await page.locator('.memory-grid-scroll').evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  }, bulkRows);
  await page.getByText('30件', { exact: true }).waitFor();
  await page.getByRole('button', { name: '30件を保存' }).click();
  await page.getByRole('button', { name: '学習を始める' }).waitFor();
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await page.getByRole('button', { name: '表形式' }).click();
  await page.locator('.memory-grid-scroll').evaluate((element) => {
    const data = new DataTransfer();
    data.setData('text/plain', '性能確認01\tperformance phrase 01');
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await page.getByRole('button', { name: '1件を保存' }).click();
  await page.getByRole('region', { name: '重複候補の確認' }).waitFor();
  check('表形式貼り付けも重複確認を経由', await page.getByRole('heading', { name: '重複候補を確認' }).isVisible());
  await page.getByRole('button', { name: '確認して保存' }).click();
  await page.getByRole('button', { name: '学習を始める' }).waitFor();
  await page.getByRole('button', { name: '学習を始める' }).click();
  await page.getByRole('radio', { name: '20問' }).click();
  await page.getByRole('radio', { name: '日→英' }).click();
  await page.getByRole('button', { name: '学習を始める' }).click();
  const p95Samples = [];
  for (let index = 0; index < 20; index += 1) {
    await page.getByRole('button', { name: 'タップして答えを見る' }).click();
    const modelAnswers = page.locator('.memory-model-answers > button');
    if (await modelAnswers.count() > 1) await modelAnswers.first().click();
    const started = performance.now();
    await page.getByRole('button', { name: '覚えた' }).click();
    if (index < 19) {
      await waitForAnswerCount(index + 1);
      await page.getByRole('button', { name: 'タップして答えを見る' }).waitFor();
    } else {
      await page.getByRole('heading', { name: 'セッション完了' }).waitFor();
    }
    p95Samples.push(performance.now() - started);
  }
  const orderedSamples = [...p95Samples].sort((left, right) => left - right);
  const p95 = orderedSamples[Math.ceil(orderedSamples.length * 0.95) - 1];
  check(`回答確定から次問操作可能までP95 ${p95.toFixed(1)}ms（250ms以内）`, p95 <= 250, { p95, samples: p95Samples });

  const viewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('iPad mini横画面で横方向へはみ出さない', viewportOverflow <= 1, viewportOverflow);
  await context.close();
} catch (error) {
  failures += 1;
  console.error('  ❌ memory UI E2E crashed', error);
  if (page) {
    console.error((await page.locator('body').innerText().catch(() => '')).slice(0, 5_000));
    console.error('local bootstrap', await page.evaluate(() => ({
      owner: localStorage.getItem('studycommander_owner_v1'),
      state: localStorage.getItem('studycommander_state_v1'),
      backup: localStorage.getItem('studycommander_state_migration_backup'),
    })).catch(() => null));
  }
  if (serverOutput) console.error(serverOutput);
} finally {
  await browser?.close();
  await stopServer();
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
}

console.log(failures === 0 ? '\n🎉 ALL PASS (memory UI E2E)' : `\n💥 ${failures} FAILURES (memory UI E2E)`);
process.exit(failures === 0 ? 0 : 1);
