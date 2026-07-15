import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const contractCss = readFileSync(new URL('../src/styles/layoutContracts.css', import.meta.url), 'utf8');

for (const label of ['今日', '計画', '教材', '記録', '分析']) {
  assert.match(appSource, new RegExp(`label: '${label}'`), `主要ナビに「${label}」を残す`);
}

assert.match(appSource, /createPortal\([\s\S]*document\.body/u, '下部ナビをdocument.bodyへPortal配置する');
assert.match(
  appSource,
  /<nav\s+[\s\S]*?className="bottom-nav"[\s\S]*?data-layout-contract="fixed-bottom-navigation"/,
  '主要5タブのナビへ固定レイアウト契約を明示する',
);
assert.match(mainSource, /import '\.\/styles\/layoutContracts\.css';/, '固定レイアウト契約CSSを読み込む');
assert.ok(
  mainSource.indexOf("import './styles/layoutContracts.css';") > mainSource.indexOf("import './styles/ux-audit.css';"),
  '固定契約CSSは一般画面CSSより後に読み込む',
);

assert.match(contractCss, /position:\s*fixed\s*!important;/, '下部ナビはviewport基準で固定する');
assert.match(contractCss, /bottom:\s*0\s*!important;/, '下部ナビを画面下端へ固定する');
assert.match(contractCss, /inset-inline:\s*0\s*!important;/, '下部ナビを画面幅基準で配置する');
assert.match(contractCss, /transform:\s*none\s*!important;/, '親変形の影響を受けない');
assert.match(contractCss, /z-index:\s*1000\s*!important;/, '他UIより前面に表示する');
assert.match(
  contractCss,
  /padding-bottom:\s*env\(safe-area-inset-bottom,\s*0px\)\s*!important;/,
  'iOS/iPadOSのホームインジケータ領域をナビの操作面から除外する',
);
assert.doesNotMatch(contractCss, /position:\s*(?:sticky|absolute|static)/, '固定契約内で別positionへ変更しない');

console.log('✅ permanent bottom navigation layout contract passed');
