import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createNoChangeAppCommandResult,
  createRejectedAppCommandResult,
  notifyAppCommandResult,
} from '../src/state/AppContext';
import {
  APP_COMMAND_MESSAGE_EVENT,
  type AppCommandMessageDetail,
} from '../src/lib/appCommandEvents';

const source = await readFile(new URL('../src/state/AppContext.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(source, /queueMicrotask|Object\.defineProperty\(result, ['"]message['"]/, 'message getterやmicrotaskの読取依存を残さない');
assert.match(source, /resolved\.status === 'rejected'[\s\S]*emitAppCommandMessage/, 'dispatch拒否は共通規則で即時通知する');
assert.match(source, /suppressNotification/, '呼出側の独自表示は明示optionで共通通知を抑止できる');
const deleteGuard = /if \(action\.type === 'DELETE_TASK'\) \{([\s\S]*?)\n  \}/u.exec(source)?.[1] ?? '';
assert.match(
  deleteGuard,
  /status: 'rejected'[\s\S]*errorCode: 'activeTaskMutation'/,
  'doingタスク削除を通知されないnoChangeではなく明示的な拒否として扱う',
);
assert.doesNotMatch(deleteGuard, /status: 'noChange'/, 'doingタスク削除を理由付きnoChangeへ戻さない');

const rejected = createRejectedAppCommandResult('変更できません', 'blocked');
assert.deepEqual(
  { status: rejected.status, changed: rejected.changed, message: rejected.message, errorCode: rejected.errorCode },
  { status: 'rejected', changed: false, message: '変更できません', errorCode: 'blocked' },
  '拒否結果を通常の値propertyを持つdiscriminated unionにする',
);
const messageDescriptor = Object.getOwnPropertyDescriptor(rejected, 'message');
assert.equal(typeof messageDescriptor?.get, 'undefined', 'message参照に副作用を持たせない');

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const eventTarget = new EventTarget();
Object.defineProperty(globalThis, 'window', { configurable: true, value: eventTarget });
const messages: AppCommandMessageDetail[] = [];
eventTarget.addEventListener(APP_COMMAND_MESSAGE_EVENT, (event) => {
  messages.push((event as CustomEvent<AppCommandMessageDetail>).detail);
});

try {
  notifyAppCommandResult(rejected);
  assert.deepEqual(messages, [{ message: '変更できません', tone: 'warning' }], '拒否はproperty読取を待たず即時通知する');

  void rejected.message;
  JSON.stringify(rejected);
  assert.equal(messages.length, 1, 'ログ・分割代入・シリアライズで通知回数を変えない');

  notifyAppCommandResult(createRejectedAppCommandResult('独自表示', 'custom'), { suppressNotification: true });
  assert.equal(messages.length, 1, '独自表示する呼出側は明示optionで重複通知を防ぐ');

  const noChange = createNoChangeAppCommandResult('変更はありません');
  notifyAppCommandResult(noChange);
  assert.equal(noChange.status, 'noChange');
  assert.equal(messages.length, 1, '正常なnoChangeでは不要な警告を出さない');

  notifyAppCommandResult(createRejectedAppCommandResult(
    '進行中のタスクは変更できません。タイマーを終了してから操作してください',
    'activeTaskMutation',
  ));
  assert.equal(messages.length, 2, 'doingタスク削除の拒否理由を1回通知する');
  assert.equal(messages[1]?.tone, 'warning', '操作不能理由を既存の警告Toastへ送る');
} finally {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  else delete (globalThis as { window?: unknown }).window;
}

console.log('✅ explicit app command notification contracts passed');
