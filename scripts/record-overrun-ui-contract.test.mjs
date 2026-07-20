import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/components/forms/RecordSheet.tsx', import.meta.url), 'utf8');

assert.match(source, /recordTaskCompletionAmount/, '完了判定は入力可能上限と分離する');
assert.match(source, /shouldDetachEditedTaskReference/, '予定量超過の編集は元タスク参照を外す');
assert.match(source, /session \? undefined : task/, '既存ログ編集は元タスク範囲ではなく教材の未完了量まで入力できる');
assert.match(source, /amountDone > taskCompletionAmount/, '予定量を超えた実績を検出する');
assert.match(source, /予定の\{taskCompletionAmount\}/, '予定量超過を利用者へ説明する');

console.log('✅ record overrun UI contract passed');
