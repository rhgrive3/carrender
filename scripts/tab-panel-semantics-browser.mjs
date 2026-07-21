import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import ts from 'typescript';

// This test executes the production guard against the same conditional mount/unmount
// pattern used by React so aria-controls never points at a missing panel.
const source = await readFile(new URL('../src/lib/tabPanelSemanticsGuard.ts', import.meta.url), 'utf8');
const executable = ts.transpileModule(
  `${source.replace(/export function normalizeTabPanelSemantics/u, 'function normalizeTabPanelSemantics').replace(/export function installTabPanelSemanticsGuard/u, 'function installTabPanelSemanticsGuard')}\ninstallTabPanelSemanticsGuard();`,
  { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2020 } },
).outputText;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 820, height: 1180 } });
  await page.setContent(`<!doctype html><html><body>
    <section class="memory-import">
      <div class="memory-import-tabs" role="tablist" aria-label="取込と出力">
        <button role="tab" aria-selected="true">取込</button>
        <button role="tab" aria-selected="false">出力</button>
        <button role="tab" aria-selected="false">AI差分</button>
      </div>
      <div class="memory-import-layout">取込内容</div>
    </section>
  </body></html>`);
  await page.addScriptTag({ content: executable });
  await page.waitForTimeout(60);

  const assertPair = async (tabIndex, tabId, panelId, actualSelector) => {
    const tab = page.locator('.memory-import-tabs [role="tab"]').nth(tabIndex);
    assert.equal(await tab.getAttribute('id'), tabId);
    assert.equal(await tab.getAttribute('aria-controls'), panelId);
    const actual = page.locator(actualSelector);
    assert.equal(await actual.getAttribute('id'), panelId);
    assert.equal(await actual.getAttribute('role'), 'tabpanel');
    assert.equal(await actual.getAttribute('aria-labelledby'), tabId);
    assert.equal(await page.locator(`#${panelId}`).count(), 1);
  };

  await assertPair(0, 'memory-import-tab-import', 'memory-import-panel-import', '.memory-import-layout');
  assert.equal(await page.locator('#memory-import-panel-export[hidden]').count(), 1);
  assert.equal(await page.locator('#memory-import-panel-ai[hidden]').count(), 1);

  await page.evaluate(() => {
    document.querySelector('.memory-import-layout')?.remove();
    const panel = document.createElement('fieldset');
    panel.className = 'memory-export-grid';
    panel.textContent = '出力内容';
    document.querySelector('.memory-import')?.append(panel);
    const tabs = [...document.querySelectorAll('.memory-import-tabs [role="tab"]')];
    tabs.forEach((tab, index) => tab.setAttribute('aria-selected', index === 1 ? 'true' : 'false'));
  });
  await page.waitForTimeout(90);
  await assertPair(1, 'memory-import-tab-export', 'memory-import-panel-export', '.memory-export-grid');
  assert.equal(await page.locator('#memory-import-panel-import[hidden]').count(), 1);

  await page.evaluate(() => {
    document.querySelector('.memory-export-grid')?.remove();
    const panel = document.createElement('div');
    panel.className = 'memory-ai-import';
    panel.textContent = 'AI差分内容';
    document.querySelector('.memory-import')?.append(panel);
    const tabs = [...document.querySelectorAll('.memory-import-tabs [role="tab"]')];
    tabs.forEach((tab, index) => tab.setAttribute('aria-selected', index === 2 ? 'true' : 'false'));
  });
  await page.waitForTimeout(90);
  await assertPair(2, 'memory-import-tab-ai', 'memory-import-panel-ai', '.memory-ai-import');
  assert.equal(await page.locator('#memory-import-panel-export[hidden]').count(), 1);

  await page.setContent(`<!doctype html><html><body>
    <section class="records-v2">
      <div class="record-view-switch" role="tablist" aria-label="記録画面の切替">
        <button role="tab" aria-selected="true">集計</button>
        <button role="tab" aria-selected="false">学習ログ</button>
      </div>
      <div class="record-overview">
        <div class="segmented" role="tablist" aria-label="集計期間">
          <button role="tab" aria-selected="true">週</button>
          <button role="tab" aria-selected="false">月</button>
        </div>
      </div>
    </section>
  </body></html>`);
  await page.addScriptTag({ content: executable });
  await page.waitForTimeout(60);
  const period = page.locator('[aria-label="集計期間"]');
  assert.equal(await period.getAttribute('role'), 'radiogroup');
  assert.equal(await period.locator('[role="radio"]').count(), 2);
  assert.equal(await period.locator('[role="radio"]').first().getAttribute('aria-checked'), 'true');
  assert.equal(await period.locator('[role="radio"]').first().getAttribute('aria-controls'), null);

  console.log('tab and panel semantics stay valid through conditional DOM switches');
} finally {
  await browser.close();
}
