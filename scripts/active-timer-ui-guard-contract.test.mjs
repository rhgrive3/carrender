import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appContext = readFileSync(new URL('../src/state/AppContext.tsx', import.meta.url), 'utf8');
const toast = readFileSync(new URL('../src/components/ui/Toast.tsx', import.meta.url), 'utf8');
const events = readFileSync(new URL('../src/lib/appCommandEvents.ts', import.meta.url), 'utf8');

assert.match(appContext, /parsed\.owner !== owner/, '別アカウントの保存タイマーを現在の計測中として扱わない');
assert.match(appContext, /action\.type === 'RECORD_SESSION'[\s\S]*action\.input\.source !== 'timer'/, '計測中タスクの手動完了記録を中央境界で拒否する');
assert.match(appContext, /action\.type === 'UPDATE_SESSION'[\s\S]*action\.input\.taskId === activeTimerTaskId/, '計測中タスクに紐づく既存記録の編集を拒否する');
assert.match(appContext, /queueMicrotask\([\s\S]*if \(!messageRead\) emitAppCommandMessage/, '拒否結果を呼び出し側が無視した場合だけ中央通知する');
assert.match(appContext, /if \(resolved\.message\) emitAppCommandMessage/, '戻り値のないdispatch拒否も無反応にしない');
assert.match(events, /studycommander:app-command-message/, '操作拒否メッセージ用イベント名を固定する');
assert.match(toast, /window\.addEventListener\(APP_COMMAND_MESSAGE_EVENT, handleCommandMessage\)/, '中央通知を既存トーストUIへ表示する');

console.log('✅ active timer UI guard contract passed');
