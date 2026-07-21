import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const guard = await read('src/lib/tabPanelSemanticsGuard.ts');
const main = await read('src/main.tsx');
const records = await read('src/screens/RecordsScreen.tsx');
const memoryImport = await read('src/features/memory/ui/MemoryImportExport.tsx');

assert.match(main, /installTabPanelSemanticsGuard\(\);[\s\S]*installRadiogroupKeyboardGuard\(\);/u, 'tabpanel契約を選択グループのroving tabindexより先に初期化する');

for (const id of [
  'records-tab-overview',
  'records-panel-overview',
  'records-tab-log',
  'records-panel-log',
  'memory-import-tab-import',
  'memory-import-panel-import',
  'memory-import-tab-export',
  'memory-import-panel-export',
  'memory-import-tab-ai',
  'memory-import-panel-ai',
]) {
  assert.match(guard, new RegExp(id, 'u'), `${id}を安定したARIA参照IDとして固定する`);
}

assert.match(guard, /tab\.setAttribute\('aria-controls', mapping\.panelId\)/u, 'tabからtabpanelをaria-controlsで参照する');
assert.match(guard, /actualPanel\.setAttribute\('role', 'tabpanel'\)/u, '表示領域をtabpanelとして公開する');
assert.match(guard, /actualPanel\.setAttribute\('aria-labelledby', mapping\.tabId\)/u, 'tabpanelから対応tabを参照する');
assert.match(guard, /placeholder\.hidden = true/u, '条件描画中の非選択tabpanelを支援技術から隠す');
assert.match(guard, /data-generated-tab-panel/u, '生成panelを実panelと区別して安全に置換する');

assert.match(guard, /group\.setAttribute\('role', 'radiogroup'\)/u, '週月切替を独立ページのtabではなく表示モード選択として公開する');
assert.match(guard, /child\.setAttribute\('role', 'radio'\)/u, '週月の選択肢をradioへ変換する');
assert.match(guard, /child\.setAttribute\('aria-checked', selected \? 'true' : 'false'\)/u, '週月の選択状態をaria-checkedへ同期する');
assert.match(guard, /child\.removeAttribute\('aria-selected'\)/u, 'radioへ変換後にtab専用aria-selectedを残さない');

assert.match(records, /record-view-switch[\s\S]*role="tablist"/u, '記録の主切替はtablistとして維持する');
assert.match(memoryImport, /memory-import-tabs[\s\S]*role="tablist"/u, '暗記取込の主切替はtablistとして維持する');
assert.match(guard, /MutationObserver\(schedule\)/u, 'Reactの条件描画・属性更新後も契約を再適用する');

console.log('✅ tab panel semantics contract passed');
