import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/SyncStatusBanner.tsx', import.meta.url), 'utf8');

assert.match(source, /aria-atomic="true"/, '同期状態の変更はタイトルと説明を一まとまりで読み上げる');
assert.match(source, /aria-labelledby=\{titleId\}/, '同期状態バナーを視覚上のタイトルと関連付ける');
assert.match(source, /aria-describedby=\{detailId\}/, '同期状態バナーを詳細説明と関連付ける');
assert.match(source, /className="sync-status-actions" role="group" aria-label="同期状態の操作"/, '同期関連ボタンを名前付き操作群として伝える');
assert.match(source, /aria-label="同期設定を確認"/, '曖昧な「確認」ボタンへ目的を含むアクセシブル名を付ける');
assert.match(source, /role=\{notice\.tone === 'error' \? 'alert' : 'status'\}/, '重大な状態はalert、進行状態はstatusとして通知する');
assert.match(source, /aria-live=\{notice\.tone === 'error' \? 'assertive' : 'polite'\}/, '重大度に対応するlive regionを使う');

const localSaveIndex = source.indexOf("const notice = localSaveError");
const conflictIndex = source.indexOf("syncStatus === 'conflict'");
const syncErrorIndex = source.indexOf("syncStatus === 'error'");
const planningErrorIndex = source.indexOf("planningStatus === 'error'");
const planningIndex = source.indexOf("planningStatus === 'planning'");
const offlineIndex = source.indexOf("syncStatus === 'offline'");

assert.ok(
  [localSaveIndex, conflictIndex, syncErrorIndex, planningErrorIndex, planningIndex, offlineIndex].every((index) => index >= 0),
  '全通知状態を選択境界へ含める',
);
assert.ok(localSaveIndex < conflictIndex, '緊急ローカル保存失敗を同期競合より先に表示する');
assert.ok(conflictIndex < syncErrorIndex, '同期競合を一般同期失敗より先に表示する');
assert.ok(syncErrorIndex < planningErrorIndex, '同期失敗を計画失敗より先に表示する');
assert.ok(planningErrorIndex < planningIndex, '計画失敗を計画中表示より先に表示する');
assert.ok(planningIndex < offlineIndex, '計画中表示がない場合にオフライン通知を表示する');
assert.match(source, /notice\.action === 'planning' \? retryPlanning : retrySync/, '表示中の通知に対応した再試行commandだけを実行する');
assert.match(source, /aria-label=\{notice\.action === 'planning' \? '計画の再計算を再試行' : 'クラウド同期を再試行'\}/, '再試行buttonのアクセシブル名を処理対象と一致させる');

console.log('✅ sync status banner accessibility and data-safety priority contract passed');
