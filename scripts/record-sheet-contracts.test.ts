import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/forms/RecordSheet.tsx', import.meta.url), 'utf8');

assert.match(source, /if \(!open\) \{\s*initializedTargetRef\.current = null;/, '閉じたシートは次回表示前に初期化対象を解除する');
assert.match(source, /actionInFlightRef\.current = false;/, '閉じたシートは操作ロックも解除する');
assert.match(source, /const save = \(\) => \{\s*if \(actionInFlightRef\.current\) return;/, '保存はsingle-flightで行う');
assert.match(source, /const remove = \(\) => \{\s*if \(!session \|\| actionInFlightRef\.current\) return;/, '削除を保存と競合させない');
assert.match(source, /const targetKey = session[\s\S]*?`session:\$\{session\.id\}`/, '編集対象ごとに入力を再初期化する');
assert.match(source, /preset\.source === 'timer' && !session/, '保存前の時間調整は新規タイマー記録だけに表示する');
assert.match(source, /id="rec-timer-minutes"[\s\S]*min=\{1\}[\s\S]*max=\{600\}/, 'タイマー時間は1〜600分で変更できる');
assert.match(source, /const taskCompletionAmount = recordTaskCompletionAmount\(task, session\);/, '完了基準量を入力可能上限と分離する');
assert.match(source, /keepsEditedReference \? session : undefined,[\s\S]*session \? undefined : task/, '既存ログ編集は教材全体の訂正可能量を入力上限にする');
assert.match(source, /const detachesTaskReference = shouldDetachEditedTaskReference\(/, '予定量超過の編集はタスク参照を外す');
assert.match(source, /const preservesTaskReference = preservesReference && !detachesTaskReference;/, '通常編集だけタスク参照を維持する');
assert.match(source, /rangeLabel: preservesTaskReference[\s\S]*?: material\?\.name \?\? ''/, '予定量超過時は教材実績として表示する');
assert.match(source, /completedTask: Boolean\([\s\S]*amountDone >= taskCompletionAmount/, '完了判定は元タスク量を基準にする');
assert.match(source, /nextAmount < taskCompletionAmount[\s\S]*setCompleted\(false\)/, '元タスク量未満へ減らした時だけ途中までへ切り替える');
assert.match(source, /Math\.max\(current, taskCompletionAmount\)/, '完了を選んでも教材残量全体へ増やさない');
assert.match(source, /予定の\{taskCompletionAmount\}/, '予定量を超えた実績の保存と再計算を案内する');
assert.match(source, /onChange=\{updateAmountDone\}/, '問題数編集は完了状態との整合処理を通す');
assert.match(source, /applyRecordSessionTransaction\(state, action, today\(\)\)/, 'タスクなし教材記録は当日から再計画する');

console.log('✅ record sheet contracts passed');
