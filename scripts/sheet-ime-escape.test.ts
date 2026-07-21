import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sheetSource = await readFile(new URL('../src/components/ui/Sheet.tsx', import.meta.url), 'utf8');
const escapeBranch = sheetSource.match(/if \(e\.key === 'Escape'\) \{([\s\S]*?)\n      \}/)?.[1] ?? '';

assert.ok(escapeBranch, 'Escapeキーの処理が存在する');
assert.match(escapeBranch, /e\.isComposing/, 'IME変換中のEscapeではシートを閉じない');
assert.match(escapeBranch, /e\.keyCode === 229/, 'IMEがcomposition状態を正しく公開しない環境も保護する');
assert.match(escapeBranch, /onCloseRef\.current\(\)/, '通常のEscapeでは最新の閉じる処理を呼ぶ');
assert.ok(
  escapeBranch.indexOf('e.isComposing') < escapeBranch.indexOf('onCloseRef.current()'),
  'IME判定を閉操作より先に行う',
);
assert.match(sheetSource, /onCloseRef\.current = requestClose/, '親の再描画後も最新の未保存確認付き閉じる処理を参照する');

assert.match(sheetSource, /closest\('\[hidden\], \[inert\], \[aria-hidden="true"\]'\)/, '祖先側で非表示・非活性になった要素をフォーカス候補から除外する');
assert.match(sheetSource, /closest\('fieldset\[disabled\]'\)/, 'disabledなfieldset配下の操作不能要素をフォーカス候補から除外する');
assert.match(sheetSource, /getComputedStyle\(element\)/, 'CSSで非表示になった要素も判定する');
assert.match(sheetSource, /getClientRects\(\)\.length > 0/, 'レイアウト上表示されている要素だけをフォーカス候補にする');
assert.match(sheetSource, /\[contenteditable="true"\]/, '編集可能要素もフォーカストラップへ含める');
assert.doesNotMatch(sheetSource, /filter\(\(element\) => !element\.hasAttribute\('hidden'\)\)/, '要素自身のhidden属性だけに依存する旧判定を再導入しない');

assert.match(sheetSource, /const active = document\.activeElement/, '現在のフォーカス位置を判定する');
assert.match(sheetSource, /active === root/, 'シート本体にある初期フォーカスを明示的に処理する');
assert.match(
  sheetSource,
  /e\.shiftKey && \(active === first \|\| active === root \|\| focusIsOutside\)/,
  '初期フォーカスからのShift+Tabを末尾要素へ循環させる',
);
assert.match(
  sheetSource,
  /!e\.shiftKey && \(active === last \|\| active === root \|\| focusIsOutside\)/,
  '初期フォーカスからのTabを先頭要素へ移動させる',
);
assert.match(sheetSource, /const focusIsOutside =/, '予期せずフォーカスが外れた場合もシート内へ戻す');

assert.match(sheetSource, /document\.getElementById\('root'\)/, 'portal外のアプリ本体を背面UIとして特定する');
assert.match(sheetSource, /appRoot\.setAttribute\('inert', ''\)/, 'シート表示中は背面UIを操作不能にする');
assert.match(sheetSource, /appRoot\.setAttribute\('aria-hidden', 'true'\)/, 'VoiceOverの仮想カーソルから背面UIを隠す');
assert.match(sheetSource, /hadInert: appRoot\.hasAttribute\('inert'\)/, '既存のinert状態を保存する');
assert.match(sheetSource, /ariaHidden: appRoot\.getAttribute\('aria-hidden'\)/, '既存のaria-hidden状態を保存する');
assert.match(sheetSource, /modalStack\.push\(backdrop\)/, '複数シートを開いた順に管理する');
assert.match(sheetSource, /const isTopmost = index === modalStack\.length - 1/, '最前面のシートを一意に判定する');
assert.match(sheetSource, /backdrop\.setAttribute\('inert', ''\)/, '背面シートを操作不能にする');
assert.match(sheetSource, /backdrop\.setAttribute\('aria-hidden', 'true'\)/, '背面シートをVoiceOverから隠す');
assert.match(sheetSource, /if \(backdropRef\.current\?\.hasAttribute\('inert'\)\) return/, '背面シートのキーボード処理を停止する');
assert.match(sheetSource, /restoreModalIsolation\(\)/, 'シート終了時に背面UIと直前シートの状態を復元する');

console.log('✅ sheet keyboard accessibility regressions passed');
