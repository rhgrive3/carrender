import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [screen, guard] = await Promise.all([
  readFile(new URL('../src/screens/RecordsScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/recordTabPanelSemantics.ts', import.meta.url), 'utf8'),
]);

assert.match(screen, /function selectTabFromKeyboard<T extends string>/u, 'タブ用の共通キーボード操作を持つ');
assert.match(screen, /event\.key === 'ArrowRight'[\s\S]*event\.key === 'ArrowLeft'[\s\S]*event\.key === 'Home'[\s\S]*event\.key === 'End'/u, '左右矢印・Home・Endを処理する');
assert.match(screen, /event\.preventDefault\(\)[\s\S]*onSelect\(next\)[\s\S]*focus\(\{ preventScroll: true \}\)/u, '選択とフォーカスを同じ次タブへ移す');

for (const id of ['record-tab-overview', 'record-tab-log', 'record-period-tab-week', 'record-period-tab-month']) {
  assert.match(screen, new RegExp(`id="${id}"[\\s\\S]*role="tab"[\\s\\S]*aria-controls=`), `${id}をpanelへ接続する`);
}
assert.match(screen, /tabIndex=\{view === 'overview' \? 0 : -1\}/u, '記録画面タブはroving tabindexを使う');
assert.match(screen, /tabIndex=\{view === 'log' \? 0 : -1\}/u, '非選択の記録画面タブをTab順から外す');
assert.match(screen, /tabIndex=\{period === 'week' \? 0 : -1\}/u, '期間タブはroving tabindexを使う');
assert.match(screen, /tabIndex=\{period === 'month' \? 0 : -1\}/u, '非選択の期間タブをTab順から外す');

assert.match(screen, /id="record-panel-overview" role="tabpanel" aria-labelledby="record-tab-overview"/u, '集計panelを集計タブへ関連付ける');
assert.match(screen, /id="record-panel-log" role="tabpanel" aria-labelledby="record-tab-log"/u, '学習ログpanelを学習ログタブへ関連付ける');
assert.match(screen, /id="record-period-panel" role="tabpanel"[\s\S]*aria-labelledby=\{period === 'week'/u, '期間panelのラベルを選択中タブへ追従させる');
assert.match(screen, /const switchPeriod = \(next: Period\) => \{\s*setPeriod\(next\);\s*setOffset\(0\);/u, '期間のキーボード切替でもoffsetを現在期間へ戻す');

assert.match(guard, /function hasCompleteNativePanels/u, '旧DOM補修guardはReact側の完成済みtabpanelを検出する');
assert.match(guard, /if \(hasCompleteNativePanels\(viewTabs\)\) return;/u, '完成済み記録tabpanelを旧guardが上書きしない');

console.log('✅ record tab keyboard and tabpanel contracts passed');
