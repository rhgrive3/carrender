import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/lib/sharecard.ts', import.meta.url), 'utf8');

const clickAt = source.indexOf('a.click();');
const delayedRevokeAt = source.indexOf('window.setTimeout(() => URL.revokeObjectURL(url), 1_000);');
assert.ok(clickAt >= 0, 'ダウンロードリンクを起動する');
assert.ok(delayedRevokeAt > clickAt, 'ダウンロード開始後にObject URLを遅延解放する');
assert.equal(source.includes('\n  URL.revokeObjectURL(url);\n'), false, 'click直後にObject URLを同期解放しない');
assert.equal(source.includes('iOS Safariではclick直後のURL解放でダウンロード開始前に参照が失われる場合がある。'), true);

console.log('✅ share card download lifecycle regressions passed');
