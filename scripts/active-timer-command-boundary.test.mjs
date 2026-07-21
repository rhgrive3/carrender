import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/state/AppContext.tsx', import.meta.url), 'utf8');
const taskRow = readFileSync(new URL('../src/components/cards/TaskRow.tsx', import.meta.url), 'utf8');

assert.match(source, /studycommander_timer_v1/, '実タイマーの永続状態をコマンド境界で参照する');
assert.match(source, /persistedTimerTaskId\(\) === taskId/, 'doing状態だけでなく実タイマー所有を照合する');
assert.match(source, /action\.type === 'UPDATE_TASK'[\s\S]*status: 'planned'/, '古いdoing状態の編集はplannedへ復旧する');
assert.match(source, /action\.type === 'POSTPONE_TASK'[\s\S]*type: 'UPDATE_TASK'[\s\S]*status: 'planned'/, '古いdoing状態の延期を成立させる');
assert.match(source, /action\.type === 'MOVE_TASK'[\s\S]*type: 'UPDATE_TASK'[\s\S]*status: 'planned'/, '古いdoing状態の日付移動を成立させる');
assert.match(source, /action\.type === 'DELETE_TASK'/, '削除操作も実タイマー保護の対象に含める');
assert.match(taskRow, /task\.status === 'doing'[\s\S]*scheduledDate: date[\s\S]*status: 'planned'/, '通常タスク行の延期も古いdoing状態を復旧する');

console.log('✅ active timer command boundary contracts passed');
