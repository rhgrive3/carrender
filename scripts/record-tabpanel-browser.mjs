import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/recordTabPanelSemantics.ts', import.meta.url), 'utf8');
const executableGuard = ts.transpileModule(
  `${source.replace(/export function installRecordTabPanelSemanticsGuard/u, 'function installRecordTabPanelSemanticsGuard')}\ninstallRecordTabPanelSemanticsGuard();`,
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
    </body></html>`);
  await page.addScriptTag({ content: executableGuard });
  await page.waitForTimeout(50);

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
  console.log('✅ record tabs remain connected to log, overview, week and month panels after DOM switches');
} finally {
  await browser.close();
}
