import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/memoryImportTabPanelSemantics.ts', import.meta.url), 'utf8');
const executable = ts.transpileModule(
  `${source.replace(/export function installMemoryImportTabPanelSemanticsGuard/u, 'function installMemoryImportTabPanelSemanticsGuard')}\ninstallMemoryImportTabPanelSemanticsGuard();`,
  { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2020 } },
).outputText;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 820, height: 1180 } });
  await page.setContent(`<!doctype html><html><body>
    <div role="tablist" aria-label="取込と出力">
      <button role="tab" aria-selected="true">取込</button>
      <button role="tab" aria-selected="false">出力</button>
      <button role="tab" aria-selected="false">AI差分</button>
    </div>
    <div class="memory-import-layout">取込内容</div>
  </body></html>`);
  await page.addScriptTag({ content: executable });
  await page.waitForTimeout(50);

  const assertPair = async (label, tabId, panelId, panelSelector) => {
    const tab = page.getByRole('tab', { name: label });
    assert.equal(await tab.getAttribute('id'), tabId);
    assert.equal(await tab.getAttribute('aria-controls'), panelId);
    const panel = page.locator(panelSelector);
    assert.equal(await panel.getAttribute('id'), panelId);
    assert.equal(await panel.getAttribute('role'), 'tabpanel');
    assert.equal(await panel.getAttribute('aria-labelledby'), tabId);
  };

  await assertPair('取込', 'memory-import-tab', 'memory-import-panel', '.memory-import-layout');

  await page.evaluate(() => {
    document.querySelector('.memory-import-layout')?.remove();
    const panel = document.createElement('fieldset');
    panel.className = 'memory-export-grid';
    panel.textContent = '出力内容';
    document.body.append(panel);
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    tabs.forEach((tab) => tab.setAttribute('aria-selected', tab.textContent?.trim() === '出力' ? 'true' : 'false'));
  });
  await page.waitForTimeout(80);
  await assertPair('出力', 'memory-export-tab', 'memory-export-panel', '.memory-export-grid');

  await page.evaluate(() => {
    document.querySelector('.memory-export-grid')?.remove();
    const panel = document.createElement('div');
    panel.className = 'memory-ai-import';
    panel.textContent = 'AI差分内容';
    document.body.append(panel);
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    tabs.forEach((tab) => tab.setAttribute('aria-selected', tab.textContent?.trim() === 'AI差分' ? 'true' : 'false'));
  });
  await page.waitForTimeout(80);
  await assertPair('AI差分', 'memory-ai-tab', 'memory-ai-panel', '.memory-ai-import');
  console.log('memory import tabs stay connected to their active tabpanels');
} finally {
  await browser.close();
}
