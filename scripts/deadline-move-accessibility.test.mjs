import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [guardSource, mainSource, planSource, appContextSource] = await Promise.all([
  readFile(new URL('../src/lib/deadlineMoveAccessibilityGuard.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/screens/PlanScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/state/AppContext.tsx', import.meta.url), 'utf8'),
]);

assert.match(guardSource, /button\.disabled = false/u);
assert.match(guardSource, /setAttribute\('aria-label', `\$\{originalLabel\}。\$\{BLOCKED_TITLE\}`\)/u);
assert.match(guardSource, /attributeFilter: \['disabled', 'title', 'aria-label'\]/u);
assert.match(mainSource, /installDeadlineMoveAccessibilityGuard/u);
assert.match(planSource, /title=\{blockedByDueDate \? '期限を過ぎるため移動できません' : undefined\}/u);
assert.match(planSource, /onClick=\{\(\) => execute\(\{ type: 'MOVE_TASK', taskId: task\.id, date: moveDate \}\)\}/u);
assert.match(appContextSource, /action\.type === 'MOVE_TASK'[\s\S]*errorCode: 'pastDueDate'/u);

console.log('✅ deadline move accessibility contract passed');
