import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/SyncStatusBanner.tsx', import.meta.url), 'utf8');

assert.match(source, /aria-atomic="true"/, '同期状態の変更はタイトルと説明を一まとまりで読み上げる');
assert.match(source, /aria-labelledby=\{titleId\}/, '同期状態バナーを視覚上のタイトルと関連付ける');
assert.match(source, /aria-describedby=\{detailId\}/, '同期状態バナーを詳細説明と関連付ける');
assert.match(source, /className="sync-status-actions" role="group" aria-label="同期状態の操作"/, '同期関連ボタンを名前付き操作群として伝える');
assert.match(source, /aria-label="同期設定を確認"/, '曖昧な「確認」ボタンへ目的を含むアクセシブル名を付ける');

console.log('✅ sync status banner accessibility contract passed');
