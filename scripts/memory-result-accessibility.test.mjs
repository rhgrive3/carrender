import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/features/memory/ui/MemoryResult.tsx', import.meta.url), 'utf8');

assert.equal(source.includes('aria-labelledby="memory-result-title"'), true, '結果画面を見出しで識別できる');
assert.equal(source.includes('role="list" aria-label="学習結果の集計"'), true, '集計カードをひとまとまりの一覧として伝える');
assert.equal(source.includes('role="list" aria-labelledby="memory-needs-review-title"'), true, '復習対象を見出し付き一覧として伝える');
assert.equal(source.includes('role="group" aria-label="学習結果の操作"'), true, '結果画面の操作群を識別できる');
assert.equal(source.includes('disabled={undoing || attempts.length === 0}'), true, '回答がない結果では取り消し操作を無効化する');
assert.equal((source.match(/aria-hidden="true"/g) ?? []).length >= 4, true, '装飾アイコンを読み上げ対象から外す');

console.log('memory result accessibility contract passed');
