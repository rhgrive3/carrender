import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sheetSource = await readFile(new URL('../src/components/ui/Sheet.tsx', import.meta.url), 'utf8');
const escapeBranch = sheetSource.match(/if \(e\.key === 'Escape'\) \{([\s\S]*?)\n      \}/)?.[1] ?? '';

assert.ok(escapeBranch, 'Escapeキーの処理が存在する');
assert.match(escapeBranch, /e\.isComposing/, 'IME変換中のEscapeではシートを閉じない');
assert.match(escapeBranch, /e\.keyCode === 229/, 'IMEがcomposition状態を正しく公開しない環境も保護する');
assert.match(escapeBranch, /onClose\(\)/, '通常のEscapeではシートを閉じる');
assert.ok(
  escapeBranch.indexOf('e.isComposing') < escapeBranch.indexOf('onClose()'),
  'IME判定を閉操作より先に行う',
);

assert.match(sheetSource, /closest\('\[hidden\], \[inert\], \[aria-hidden="true"\]'\)/, '祖先側で非表示・非活性になった要素をフォーカス候補から除外する');
assert.match(sheetSource, /closest\('fieldset\[disabled\]'\)/, 'disabledなfieldset配下の操作不能要素をフォーカス候補から除外する');
assert.match(sheetSource, /getComputedStyle\(element\)/, 'CSSで非表示になった要素も判定する');
assert.match(sheetSource, /getClientRects\(\)\.length > 0/, 'レイアウト上表示されている要素だけをフォーカス候補にする');
assert.match(sheetSource, /\[contenteditable="true"\]/, '編集可能要素もフォーカストラップへ含める');
assert.doesNotMatch(sheetSource, /filter\(\(element\) => !element\.hasAttribute\('hidden'\)\)/, '要素自身のhidden属性だけに依存する旧判定を再導入しない');

console.log('✅ sheet keyboard accessibility regressions passed');
