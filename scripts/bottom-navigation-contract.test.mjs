import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const guardSource = readFileSync(new URL('../src/lib/fixedBottomNavigationGuard.ts', import.meta.url), 'utf8');
const contractCss = readFileSync(new URL('../src/styles/layoutContracts.css', import.meta.url), 'utf8');
const accessibilityCss = readFileSync(new URL('../src/styles/accessibility-polish.css', import.meta.url), 'utf8');

for (const label of ['今日', '計画', '教材', '記録', '振り返り']) {
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

const styleImports = [...mainSource.matchAll(/import '(\.\/styles\/[^']+\.css)';/gu)].map((match) => match[1]);
assert.equal(styleImports.at(-1), './styles/layoutContracts.css', '固定契約CSSは全画面CSSの最後に読み込む');
assert.equal(
  styleImports.filter((path) => path === './styles/layoutContracts.css').length,
  1,
  '固定契約CSSを重複読込せず、唯一の最終上書き層にする',
);
assert.match(
  mainSource,
  /永続UX契約: 主要5タブは常にviewport下端へ固定する。[\s\S]*layoutContracts\.cssより後ろへ置いてはならない/,
  '新しいCSS追加時も下部ナビ固定契約を最後に保つルールを入口へ明記する',
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
assert.match(contractCss, /transform:\s*none\s*!important;/, '通常状態では固定ナビ自体へ変形を残さない');
assert.match(contractCss, /display:\s*flex\s*!important;/, '通常画面の固定ナビを意図せず非表示にしない');
assert.match(contractCss, /width:\s*min\(100%,\s*760px\)\s*!important;/, 'スクロールバーを含む100vwへ依存せず画面幅内へ収める');
assert.match(contractCss, /--bottom-nav-content-size:\s*max\(var\(--nav-height\),\s*4\.5rem\)/, '文字拡大へ追従するナビ高をrem基準で持つ');
assert.match(
  contractCss,
  /min-height:\s*calc\(var\(--bottom-nav-content-size\)\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\)\s*!important;/,
  'Safe Areaと文字拡大を含む最小高を固定契約に含める',
);
assert.match(contractCss, /height:\s*auto\s*!important;/, '固定px高でDynamic Typeのラベルを切らない');
assert.match(contractCss, /padding-bottom:\s*env\(safe-area-inset-bottom,\s*0px\)\s*!important;/, 'iOS/iPadOSのホームインジケータ領域を操作面から除外する');
assert.match(contractCss, />\s*button\s*\{[\s\S]*?min-height:\s*var\(--bottom-nav-content-size\)/, '各タブの操作面も拡張後のナビ高へ追従する');
assert.match(contractCss, /font-size:\s*max\(0\.75rem,\s*12px\)/, '小さすぎるラベルを可読な下限へ引き上げる');
assert.match(
  contractCss,
  /\.screen\s*\{[\s\S]*?padding-bottom:\s*calc\(var\(--bottom-nav-content-size\)[\s\S]*?safe-area-inset-bottom[\s\S]*?28px\)/,
  '文字拡大でナビが高くなっても本文最下部を背面へ隠さない',
);
assert.doesNotMatch(contractCss, /position:\s*(?:sticky|absolute|static)/, '固定契約内で別positionへ変更しない');

assert.match(mainSource, /import \{ installFixedBottomNavigationGuard \} from '\.\/lib\/fixedBottomNavigationGuard';/, 'アプリ入口で実行時固定ガードを読み込む');
assert.match(mainSource, /installFixedBottomNavigationGuard\(\);[\s\S]*preserveUnreadableState\(\);/, 'React描画前に固定ガードを有効化する');
assert.match(guardSource, /body > \.bottom-nav\[data-layout-contract='fixed-bottom-navigation'\]/, '実行時ガードもbody直下の本ナビだけを対象にする');
for (const [property, value] of [['position', 'fixed'], ['bottom', '0px'], ['left', '0px'], ['right', '0px'], ['margin-inline', 'auto']]) {
  assert.match(
    guardSource,
    new RegExp(`\\{ property: '${property}', value: '${value}' \\}`),
    `${property}の実行時固定値を保持する`,
  );
}
assert.match(guardSource, /window\.visualViewport\?\.height/, 'iPadの見えているviewport下端を基準にする');
assert.match(guardSource, /const delta = visibleViewportBottom\(\) - rect\.bottom/, '実測した下端ずれを補正する');
assert.match(guardSource, /translate3d\(0, \$\{offset\}px, 0\)/, 'iPadOSのfixedずれを限定的な実測offsetで補正する');
assert.match(guardSource, /new MutationObserver\(schedule\)/, 'DOM後発変更でも固定を再確認する');
assert.match(guardSource, /new MutationObserver\(\(\) => schedule\(\)\)/, 'ナビ自身の属性変更も即時に固定し直す');
assert.match(guardSource, /attributeFilter:\s*\['style', 'class', 'data-layout-contract'\]/, '位置を変え得るstyle・class・契約属性を監視する');
assert.match(guardSource, /if \(fixedInvariantsMatch\(nav, offset\)\) return false;/, '正常なスクロール中は同じ固定styleを再書込みしない');
assert.match(guardSource, /navAttributeObserver\?\.disconnect\(\);[\s\S]*applyFixedInvariants\(nav, offset\);[\s\S]*observeNavAttributes\(nav\);/, '実際のstyle修復時だけobserverを止めて監視ループを作らない');
assert.match(guardSource, /new ResizeObserver\(\(\) => schedule\(\)\)/, 'ナビ自身の高さ変更でも下端を再計算する');
assert.match(guardSource, /window\.addEventListener\('scroll', schedule/, 'ページスクロール中も固定を監視する');
assert.match(guardSource, /window\.visualViewport\?\.addEventListener\('resize', schedule/, 'Visual Viewport変化後も固定値を再確認する');
assert.match(guardSource, /window\.visualViewport\?\.addEventListener\('scroll', schedule/, 'Visual Viewportスクロールでも固定値を再確認する');

assert.match(
  contractCss,
  /\.plan-history-launcher\.floating\s*\{[\s\S]*?bottom:\s*calc\(var\(--bottom-nav-content-size\)[\s\S]*?safe-area-inset-bottom[\s\S]*?14px\)\s*!important;/,
  '計画履歴ボタンを文字拡大後のナビ上端より上へ保つ',
);
assert.match(contractCss, /\.plan-history-launcher\.floating\s*\{[\s\S]*?z-index:\s*60\s*!important;/, '計画履歴ボタンを下部ナビの上へ保つ');
assert.match(
  contractCss,
  /\.plan-history-launcher\.floating\s*\{[\s\S]*?right:\s*max\(14px,\s*env\(safe-area-inset-right,\s*0px\)\)\s*!important;/,
  '横向きのノッチ・角丸領域から計画履歴ボタンを退避する',
);

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

console.log('✅ permanent bottom navigation CSS, real-app and visual-viewport runtime contracts passed');
