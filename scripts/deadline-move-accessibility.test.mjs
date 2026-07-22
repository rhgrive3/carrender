import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [guardSource, mainSource, planSource, appContextSource] = await Promise.all([
  readFile(new URL('../src/lib/deadlineMoveAccessibilityGuard.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/screens/PlanScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/state/AppContext.tsx', import.meta.url), 'utf8'),
]);

assert.match(guardSource, /if \(button\.disabled\) button\.disabled = false/u);
assert.match(guardSource, /setAttributeIfChanged\(button, 'aria-label', accessibleLabel\)/u);
// 監視対象属性を同値で書き直すとMutationObserverが自己再発火し得るため、差分時だけ更新する。
assert.match(guardSource, /if \(element\.getAttribute\(name\) !== value\) element\.setAttribute\(name, value\)/u);
assert.doesNotMatch(guardSource, /button\.setAttribute\('aria-label', `\$\{originalLabel\}。\$\{BLOCKED_TITLE\}`\)/u);
assert.match(guardSource, /attributeFilter: \['disabled', 'title', 'aria-label'\]/u);
assert.match(mainSource, /installDeadlineMoveAccessibilityGuard/u);
assert.match(planSource, /title=\{blockedByDueDate \? '期限を過ぎるため移動できません' : undefined\}/u);
assert.match(planSource, /onClick=\{\(\) => execute\(\{ type: 'MOVE_TASK', taskId: task\.id, date: moveDate \}\)\}/u);
assert.match(appContextSource, /action\.type === 'MOVE_TASK'[\s\S]*errorCode: 'pastDueDate'/u);

console.log('✅ deadline move accessibility contract passed');
