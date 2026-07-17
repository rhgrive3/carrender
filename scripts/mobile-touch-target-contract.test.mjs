import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const globalCss = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
const toastCss = readFileSync(new URL('../src/components/ui/Toast.css', import.meta.url), 'utf8');
const syncCss = readFileSync(new URL('../src/components/SyncStatusBanner.css', import.meta.url), 'utf8');
const iosFormCss = readFileSync(new URL('../src/styles/ios-form-controls.css', import.meta.url), 'utf8');

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? '';
}

function assertTouchHeight(css, selector) {
  assert.match(rule(css, selector), /min-height:\s*44px|height:\s*44px/,
    `${selector} の主要タップ領域は44px以上にする`);
}

assertTouchHeight(globalCss, '.btn-sm');
assertTouchHeight(globalCss, '.period-nav button');
assertTouchHeight(globalCss, '.day-column-header');
assertTouchHeight(globalCss, '.task-line-actions .btn');
assertTouchHeight(globalCss, '.line-icon-btn');
assertTouchHeight(toastCss, '.app-toast-link,\n.app-toast-action,\n.app-toast-close');
assertTouchHeight(syncCss, '.sync-status-actions button');

assert.match(
  iosFormCss,
  /input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\):not\(\[type='range'\]\):not\(\[type='color'\]\):not\(\[type='hidden'\]\),[\s\S]*select,[\s\S]*textarea\s*\{[\s\S]*min-height:\s*44px/,
  '小型ネイティブ部品を除外し、テキスト入力系フォームを44pt以上にする',
);
assert.match(
  iosFormCss,
  /\[role='button'\],[\s\S]*summary\s*\{[\s\S]*min-width:\s*44px;[\s\S]*min-height:\s*44px/,
  '独自ボタンとsummaryを44x44pt以上にする',
);

console.log('mobile touch target contract test passed');