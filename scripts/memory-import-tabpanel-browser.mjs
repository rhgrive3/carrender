import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/memoryImportTabPanelSemantics.ts', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
const component = await readFile(new URL('../src/features/memory/ui/MemoryImportExport.tsx', import.meta.url), 'utf8');
assert.match(main, /installMemoryImportTabPanelSemanticsGuard\(\);/u, 'アプリ起動時に暗記取込tabpanel契約を有効化する');
assert.match(component, /memory-import-tabs[\s\S]*role="tablist"/u, '暗記取込の3選択肢をtablistとして維持する');

const executableGuard = ts.transpileModule(
  `${source
    .replace(/export function connectMemoryImportTabsToPanels/u, 'function connectMemoryImportTabsToPanels')
    .replace(/export function installMemoryImportTabPanelSemanticsGuard/u, 'function installMemoryImportTabPanelSemanticsGuard')}\ninstallMemoryImportTabPanelSemanticsGuard();`,
  { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2020 } },
).outputText;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 820, height: 1180 } });
  await page.setContent(`<!doctype html>
    <html><body>
      <section class="memory-import">
        <div class="memory-import-tabs" role="tablist" aria-label="取込と出力">
          <button role="tab" aria-selected="true">取込</button>
          <button role="tab" aria-selected="false">出力</button>
          <button role="tab" aria-selected="false">AI差分</button>
        </div>
        <div class="memory-import-layout">取込内容</div>
      </section>
    </body></html>`);
  await page.addScriptTag({ content: executableGuard });
  await page.waitForTimeout(60);

  const tabState = async (label) => page.getByRole('tab', { name: label }).evaluate((element) => ({
    id: element.id,
    controls: element.getAttribute('aria-controls'),
    selected: element.getAttribute('aria-selected'),
  }));
  const panelState = async (id) => page.locator(`#${id}`).evaluate((element) => ({
    role: element.getAttribute('role'),
    labelledBy: element.getAttribute('aria-labelledby'),
    hidden: element.hasAttribute('hidden'),
  }));

  assert.deepEqual(await tabState('取込'), {
    id: 'memory-import-tab-import',
    controls: 'memory-import-panel-import',
    selected: 'true',
  });
  assert.deepEqual(await panelState('memory-import-panel-import'), {
    role: 'tabpanel',
    labelledBy: 'memory-import-tab-import',
    hidden: false,
  });
  assert.deepEqual(await panelState('memory-import-panel-export'), {
    role: 'tabpanel',
    labelledBy: 'memory-import-tab-export',
    hidden: true,
  });
  assert.deepEqual(await panelState('memory-import-panel-ai'), {
    role: 'tabpanel',
    labelledBy: 'memory-import-tab-ai',
    hidden: true,
  });

  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    tabs.forEach((tab) => tab.setAttribute('aria-selected', tab.textContent?.trim() === '出力' ? 'true' : 'false'));
    document.querySelector('.memory-import-layout')?.remove();
    const exportPanel = document.createElement('fieldset');
    exportPanel.className = 'memory-export-grid';
    exportPanel.textContent = '出力内容';
    document.querySelector('.memory-import')?.append(exportPanel);
  });
  await page.waitForTimeout(100);

  assert.deepEqual(await tabState('出力'), {
    id: 'memory-import-tab-export',
    controls: 'memory-import-panel-export',
    selected: 'true',
  });
  assert.deepEqual(await panelState('memory-import-panel-export'), {
    role: 'tabpanel',
    labelledBy: 'memory-import-tab-export',
    hidden: false,
  });
  assert.deepEqual(await panelState('memory-import-panel-import'), {
    role: 'tabpanel',
    labelledBy: 'memory-import-tab-import',
    hidden: true,
  });

  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    tabs.forEach((tab) => tab.setAttribute('aria-selected', tab.textContent?.trim() === 'AI差分' ? 'true' : 'false'));
    document.querySelector('.memory-export-grid')?.remove();
    const aiPanel = document.createElement('div');
    aiPanel.className = 'memory-ai-import';
    aiPanel.textContent = 'AI差分内容';
    document.querySelector('.memory-import')?.append(aiPanel);
  });
  await page.waitForTimeout(100);

  assert.deepEqual(await tabState('AI差分'), {
    id: 'memory-import-tab-ai',
    controls: 'memory-import-panel-ai',
    selected: 'true',
  });
  assert.deepEqual(await panelState('memory-import-panel-ai'), {
    role: 'tabpanel',
    labelledBy: 'memory-import-tab-ai',
    hidden: false,
  });
  for (const id of ['memory-import-panel-import', 'memory-import-panel-export', 'memory-import-panel-ai']) {
    assert.equal(await page.locator(`#${id}`).count(), 1, `${id} remains unique after conditional DOM switches`);
  }

  console.log('✅ memory import tabs remain connected to import, export and AI panels after DOM switches');
} finally {
  await browser.close();
}
