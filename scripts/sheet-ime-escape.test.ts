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

console.log('✅ sheet IME escape regressions passed');
