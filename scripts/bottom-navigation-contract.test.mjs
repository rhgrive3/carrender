import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const contractCss = readFileSync(new URL('../src/styles/layoutContracts.css', import.meta.url), 'utf8');
const accessibilityCss = readFileSync(new URL('../src/styles/accessibility-polish.css', import.meta.url), 'utf8');

for (const label of ['今日', '計画', '教材', '記録', '分析']) {
  assert.match(appSource, new RegExp(`label: '${label}'`), `主要ナビに「${label}」を残す`);
}

assert.match(
  appSource,
  /<nav\s+[\s\S]*?className="bottom-nav"[\s\S]*?data-layout-contract="fixed-bottom-navigation"/,
  '主要5タブのナビへ固定レイアウト契約を明示する',
);
assert.match(appSource, /import \{ createPortal \} from 'react-dom';/, '下部ナビをReact portalで祖先レイアウトから分離する');
assert.match(
  appSource,
  /createPortal\([\s\S]*?<nav[\s\S]*?data-portal-target="document\.body"[\s\S]*?document\.body,?[\s\S]*?\)/,
  '下部ナビのDOMをdocument.body直下へポータルする',
);
assert.match(mainSource, /<main id="app-main-content"[\s\S]*?<App key=\{dayKey\} \/>[\s\S]*?<\/main>/, '画面本文はmainランドマーク内に保つ');
assert.match(mainSource, /import '\.\/styles\/layoutContracts\.css';/, '固定レイアウト契約CSSを読み込む');
assert.ok(
  mainSource.indexOf("import './styles/layoutContracts.css';") > mainSource.indexOf("import './styles/ux-audit.css';"),
  '固定契約CSSは一般画面CSSより後に読み込む',
);

assert.match(
  contractCss,
  /body\s*>\s*\.bottom-nav\[data-layout-contract='fixed-bottom-navigation'\]/,
  '固定契約はdocument.body直下のナビだけへ適用する',
);
assert.match(contractCss, /position:\s*fixed\s*!important;/, '下部ナビはviewport基準で固定する');
assert.match(contractCss, /bottom:\s*0\s*!important;/, '下部ナビを画面下端へ固定する');
assert.match(contractCss, /left:\s*0\s*!important;/, '固定要素をビューポート左端基準にする');
assert.match(contractCss, /right:\s*0\s*!important;/, '固定要素をビューポート右端基準にする');
assert.match(contractCss, /margin-inline:\s*auto\s*!important;/, '下部ナビを画面中央へ配置する');
assert.match(contractCss, /transform:\s*none\s*!important;/, '固定ナビ自体へ変形を残さない');
assert.match(contractCss, /display:\s*flex\s*!important;/, '通常画面の固定ナビを意図せず非表示にしない');
assert.match(contractCss, /width:\s*min\(100%,\s*760px\)\s*!important;/, 'スクロールバーを含む100vwへ依存せず画面幅内へ収める');
assert.match(contractCss, /--bottom-nav-content-size:\s*max\(var\(--nav-height\),\s*4\.5rem\)/, '文字拡大へ追従するナビ高をrem基準で持つ');
assert.match(
  contractCss,
  /min-height:\s*calc\(var\(--bottom-nav-content-size\)\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\)\s*!important;/,
  'Safe Areaと文字拡大を含む最小高を固定契約に含める',
);
assert.match(contractCss, /height:\s*auto\s*!important;/, '固定px高でDynamic Typeのラベルを切らない');
assert.match(
  contractCss,
  /padding-bottom:\s*env\(safe-area-inset-bottom,\s*0px\)\s*!important;/,
  'iOS/iPadOSのホームインジケータ領域をナビの操作面から除外する',
);
assert.match(contractCss, />\s*button\s*\{[\s\S]*?min-height:\s*var\(--bottom-nav-content-size\)/, '各タブの操作面も拡張後のナビ高へ追従する');
assert.match(contractCss, /font-size:\s*max\(0\.75rem,\s*12px\)/, '10.5pxの小さすぎるラベルを可読な下限へ引き上げる');
assert.match(
  contractCss,
  /\.screen\s*\{[\s\S]*?padding-bottom:\s*calc\(var\(--bottom-nav-content-size\)[\s\S]*?safe-area-inset-bottom[\s\S]*?28px\)/,
  '文字拡大でナビが高くなっても本文最下部を背面へ隠さない',
);
assert.doesNotMatch(contractCss, /position:\s*(?:sticky|absolute|static)/, '固定契約内で別positionへ変更しない');

assert.match(
  accessibilityCss,
  /\.bottom-nav button\[aria-current='page'\]::before\s*\{[\s\S]*?background:\s*transparent;/,
  '旧active疑似要素を消し、選択中タブの背景を二重表示しない',
);
assert.match(
  accessibilityCss,
  /\.bottom-nav button\[aria-current='page'\] \.nav-icon\s*\{[\s\S]*?background:\s*var\(--accent-soft\);[\s\S]*?box-shadow:/,
  '選択中タブは色だけでなくアイコン背景の形状と境界でも現在地を示す',
);
assert.match(
  accessibilityCss,
  /\.bottom-nav \.nav-icon\s*\{[\s\S]*?width:\s*40px;[\s\S]*?height:\s*28px;/,
  '選択インジケータはタブ切替時にレイアウトシフトしない固定寸法にする',
);
assert.match(
  accessibilityCss,
  /@media \(forced-colors: active\)[\s\S]*?button\[aria-current='page'\] \.nav-icon[\s\S]*?Highlight/,
  '強制カラーモードでも選択中タブの非色依存インジケータを維持する',
);

console.log('✅ permanent bottom navigation layout contract passed');
