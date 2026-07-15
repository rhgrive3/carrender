import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EMPTY_TOAST_QUEUE,
  TOAST_QUEUE_LIMIT,
  TOAST_TITLE_LIMIT,
  advanceToast,
  createToastItem,
  enqueueToast,
  inferToastTone,
  toastDurationMs,
} from '../src/components/ui/toastModel';

const longMessage = '保存しましたが、一部のタスクは未配置です。固定予定と教材期限を確認し、必要に応じて勉強可能時間を増やしてください。変更内容は端末に保存されています。';
const compact = createToastItem(longMessage, undefined, 'long');
assert.ok(Array.from(compact.title).length <= TOAST_TITLE_LIMIT, '長文通知は初期表示を短い見出しへ圧縮する');
assert.equal(compact.detail, longMessage, '省略した全文は詳細表示から確認できる');
assert.equal(compact.tone, 'warning', '一部未配置は警告として扱う');

const short = createToastItem('教材を保存しました', undefined, 'short');
assert.equal(short.title, '教材を保存しました');
assert.equal(short.detail, null, '短い通知に不要な詳細操作を出さない');
assert.equal(short.tone, 'success');

assert.equal(inferToastTone('クラウド同期に失敗しました'), 'error');
assert.equal(inferToastTone('通知が許可されていません'), 'warning');
assert.ok(toastDurationMs('error') > toastDurationMs('success'), 'エラーは成功通知より長く読める');
assert.ok(toastDurationMs('info', undefined, true) >= 7_000, '操作付き通知は操作できる時間を確保する');

let queue = enqueueToast(EMPTY_TOAST_QUEUE, short);
queue = enqueueToast(queue, short);
assert.equal(queue.queued.length, 0, '同じ通知の連続発火を重複表示しない');

for (let index = 0; index < TOAST_QUEUE_LIMIT + 2; index += 1) {
  queue = enqueueToast(queue, createToastItem(`通知 ${index}`, 'info', `queued-${index}`));
}
assert.equal(queue.queued.length, TOAST_QUEUE_LIMIT, '通知待ち行列を無制限に増やさない');
const previousActive = queue.active;
queue = advanceToast(queue);
assert.notEqual(queue.active?.id, previousActive?.id, '閉じた後は待機中の次の通知を表示する');

const toastSource = readFileSync(new URL('../src/components/ui/Toast.tsx', import.meta.url), 'utf8');
assert.match(toastSource, /app-toast-close/, '通知を利用者が明示的に閉じられる');
assert.match(toastSource, /詳細を閉じる|詳細/, '長文は段階表示する');
assert.match(toastSource, /queue\.queued\.length/, '複数通知を上書きせず順番に扱う');

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const syncSource = readFileSync(new URL('../src/components/SyncStatusBanner.tsx', import.meta.url), 'utf8');
assert.match(appSource, /<SyncStatusBanner/, '同期異常を設定画面の外から確認できる');
assert.match(syncSource, /変更内容はこの端末に保存済み/, '同期失敗時にローカル保存済みであることを短く伝える');
assert.doesNotMatch(syncSource, /syncErrorMessage/, '低レベルの長いAPIエラーを常設バナーへ直接表示しない');

console.log('✅ professional notification UX regressions passed');
