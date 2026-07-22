import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import ts from 'typescript';

const tabSource = await readFile(new URL('../src/lib/recordTabPanelSemantics.ts', import.meta.url), 'utf8');
const logSource = await readFile(new URL('../src/lib/recordLogAccessibilityGuard.ts', import.meta.url), 'utf8');
const executableTabGuard = ts.transpileModule(
  `${tabSource.replace(/export function installRecordTabPanelSemanticsGuard/u, 'function installRecordTabPanelSemanticsGuard')}\ninstallRecordTabPanelSemanticsGuard();`,
  { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2020 } },
).outputText;
const executableLogGuard = ts.transpileModule(
  `${logSource
    .replace(/export function normalizeRecordLogAccessibility/u, 'function normalizeRecordLogAccessibility')
    .replace(/export function installRecordLogAccessibilityGuard/u, 'function installRecordLogAccessibilityGuard')}\ninstallRecordLogAccessibilityGuard();`,
  { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2020 } },
).outputText;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 820, height: 1180 } });
  await page.setContent(`<!doctype html>
    <html><body>
      <div role="tablist" aria-label="記録画面の切替">
        <button role="tab" aria-selected="false">集計</button>
        <button role="tab" aria-selected="true">学習ログ</button>
      </div>
      <section class="record-log-view"><h2>学習ログ</h2></section>
      <div class="record-log-list">
        <div class="row spread"><span>7/22 (水)</span><span>1時間45分</span></div>
        <button class="task-card session-log-button" aria-label="英単語帳の記録を編集">
          <div class="task-main">
            <div class="task-meta-row"><span class="subject-chip">英語</span><span class="task-type-chip">タイマー</span></div>
            <div class="task-title">英単語帳</div>
            <div class="task-range">1時間 ・ 3ページ ・ 🔥4</div>
            <div class="faint mt-8">長いメモ本文は名称へ含めない</div>
          </div>
        </button>
        <button class="task-card session-log-button" aria-label="英単語帳の記録を編集">
          <div class="task-main">
            <div class="task-meta-row"><span class="subject-chip">英語</span><span class="task-type-chip">手入力</span></div>
            <div class="task-title">英単語帳</div>
            <div class="task-range">45分 ・ 2ページ</div>
          </div>
        </button>
      </div>
    </body></html>`);
  await page.addScriptTag({ content: executableTabGuard });
  await page.addScriptTag({ content: executableLogGuard });
  await page.waitForTimeout(80);

  const readTab = async (label) => page.getByRole('tab', { name: label }).evaluate((element) => ({
    id: element.id,
    controls: element.getAttribute('aria-controls'),
    selected: element.getAttribute('aria-selected'),
  }));
  const readPanel = async (selector) => page.locator(selector).evaluate((element) => ({
    id: element.id,
    role: element.getAttribute('role'),
    labelledBy: element.getAttribute('aria-labelledby'),
  }));

  assert.deepEqual(await readTab('学習ログ'), {
    id: 'records-log-tab',
    controls: 'records-log-panel',
    selected: 'true',
  });
  assert.deepEqual(await readPanel('.record-log-view'), {
    id: 'records-log-panel',
    role: 'tabpanel',
    labelledBy: 'records-log-tab',
  });

  const logButtons = page.locator('.session-log-button');
  assert.equal(await logButtons.nth(0).getAttribute('aria-label'), null, '可視内容を上書きするaria-labelを除去する');
  assert.ok(await logButtons.nth(0).getAttribute('aria-labelledby'), '教材名と編集操作をaria-labelledbyへ接続する');
  assert.ok(await logButtons.nth(0).getAttribute('aria-describedby'), '記録詳細をaria-describedbyへ接続する');
  const timerSnapshot = await logButtons.nth(0).ariaSnapshot();
  assert.match(timerSnapshot, /英単語帳/);
  assert.match(timerSnapshot, /記録を編集/);
  assert.match(timerSnapshot, /7\/22 \(水\)/);
  assert.match(timerSnapshot, /英語/);
  assert.match(timerSnapshot, /タイマー/);
  assert.match(timerSnapshot, /1時間、3ページ、集中度 4/);
  assert.match(timerSnapshot, /メモあり/);
  assert.doesNotMatch(timerSnapshot, /長いメモ本文は名称へ含めない/, '長文メモ本文は読み上げ説明へ含めない');

  const manualSnapshot = await logButtons.nth(1).ariaSnapshot();
  assert.match(manualSnapshot, /英単語帳/);
  assert.match(manualSnapshot, /手入力/);
  assert.match(manualSnapshot, /45分、2ページ/);
  assert.notEqual(timerSnapshot, manualSnapshot, '同名教材でも時間・量・入力方法で区別できる');

  await logButtons.nth(0).evaluate((element) => {
    element.setAttribute('aria-label', '英単語帳の記録を編集');
    const range = element.querySelector('.task-range');
    if (range) range.textContent = '1時間15分 ・ 4ページ ・ 🔥5';
  });
  await page.waitForTimeout(80);
  const updatedSnapshot = await logButtons.nth(0).ariaSnapshot();
  assert.equal(await logButtons.nth(0).getAttribute('aria-label'), null, 'React相当の再描画でaria-labelが戻っても除去する');
  assert.match(updatedSnapshot, /1時間15分、4ページ、集中度 5/, '表示更新後の記録内容へ説明を追従する');

  await page.evaluate(() => {
    document.querySelector('[role="tab"][aria-selected="true"]')?.setAttribute('aria-selected', 'false');
    [...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent?.trim() === '集計')?.setAttribute('aria-selected', 'true');
    document.querySelector('.record-log-view')?.remove();
    const overview = document.createElement('div');
    overview.className = 'record-overview';
    overview.innerHTML = `
      <div role="tablist" aria-label="集計期間">
        <button role="tab" aria-selected="true">週</button>
        <button role="tab" aria-selected="false">月</button>
      </div>
      <div class="card studyplus-chart-card">週グラフ</div>`;
    document.body.append(overview);
  });
  await page.waitForTimeout(80);

  assert.deepEqual(await readTab('集計'), {
    id: 'records-overview-tab',
    controls: 'records-overview-panel',
    selected: 'true',
  });
  assert.deepEqual(await readPanel('.record-overview'), {
    id: 'records-overview-panel',
    role: 'tabpanel',
    labelledBy: 'records-overview-tab',
  });
  assert.deepEqual(await readTab('週'), {
    id: 'records-week-tab',
    controls: 'records-week-panel',
    selected: 'true',
  });
  assert.deepEqual(await readPanel('.studyplus-chart-card'), {
    id: 'records-week-panel',
    role: 'tabpanel',
    labelledBy: 'records-week-tab',
  });

  await page.evaluate(() => {
    const week = [...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent?.trim() === '週');
    const month = [...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent?.trim() === '月');
    week?.setAttribute('aria-selected', 'false');
    month?.setAttribute('aria-selected', 'true');
    document.querySelector('.studyplus-chart-card')?.remove();
    const monthCard = document.createElement('div');
    monthCard.className = 'card month-card';
    monthCard.innerHTML = '<div data-month-calendar>月カレンダー</div>';
    document.querySelector('.record-overview')?.append(monthCard);
  });
  await page.waitForTimeout(80);

  assert.deepEqual(await readTab('月'), {
    id: 'records-month-tab',
    controls: 'records-month-panel',
    selected: 'true',
  });
  assert.deepEqual(await readPanel('.month-card'), {
    id: 'records-month-panel',
    role: 'tabpanel',
    labelledBy: 'records-month-tab',
  });

  assert.equal(await page.locator('#records-overview-tab').count(), 1, 'overview tab id stays unique');
  assert.equal(await page.locator('#records-month-panel').count(), 1, 'active month panel id stays unique');
  console.log('✅ record tabs and same-title learning logs remain distinguishable after DOM switches');
} finally {
  await browser.close();
}
