import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appContext = readFileSync(new URL('../src/state/AppContext.tsx', import.meta.url), 'utf8');
const identity = readFileSync(new URL('../src/lib/timerTargetIdentity.ts', import.meta.url), 'utf8');
const toast = readFileSync(new URL('../src/components/ui/Toast.tsx', import.meta.url), 'utf8');
const events = readFileSync(new URL('../src/lib/appCommandEvents.ts', import.meta.url), 'utf8');

assert.match(appContext, /parsePersistedTimerTarget\(JSON\.parse\(raw\), owner\)/, '別アカウントを含む保存タイマー解析を共有helperへ委譲する');
assert.match(identity, /export function timerTargetsSameWork/, '同じ作業の判定規則を共有domain helperへ集約する');
assert.match(identity, /left\.taskId && right\.taskId && left\.taskId === right\.taskId/, '同じtask IDを完全一致として優先する');
assert.match(identity, /left\.sourceId !== right\.sourceId[\s\S]*left\.materialId !== right\.materialId[\s\S]*sameRange/, '再計算後はsource・教材・範囲で同一作業を照合する');
assert.match(appContext, /action\.type === 'RECORD_SESSION'[\s\S]*action\.input\.source !== 'timer'[\s\S]*timerTargetMatchesSessionInput/, '計測中タスクの手動完了記録を中央境界で拒否する');
assert.match(appContext, /action\.type === 'UPDATE_SESSION'[\s\S]*timerTargetMatchesSession\(target, previous\)/, '編集後に参照を外しても編集前の計測中タスクを保護する');
assert.match(appContext, /action\.type === 'DELETE_SESSION'[\s\S]*timerTargetMatchesSession\(target, previous\)/, '計測中タスクに紐づく既存記録の削除を拒否する');
assert.match(appContext, /queueMicrotask\([\s\S]*if \(!messageRead\) emitAppCommandMessage/, '拒否結果を呼び出し側が無視した場合だけ中央通知する');
assert.match(appContext, /if \(resolved\.message\) emitAppCommandMessage/, '戻り値のないdispatch拒否も無反応にしない');
assert.match(events, /studycommander:app-command-message/, '操作拒否メッセージ用イベント名を固定する');
assert.match(toast, /window\.addEventListener\(APP_COMMAND_MESSAGE_EVENT, handleCommandMessage\)/, '中央通知を既存トーストUIへ表示する');

console.log('✅ active timer UI guard contract passed');
