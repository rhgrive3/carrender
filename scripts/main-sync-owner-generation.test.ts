import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AsyncOwnerGenerationGuard } from '../src/lib/asyncOwnerGeneration';

const guard = new AsyncOwnerGenerationGuard('owner-a');
const ownerA = guard.capture();
assert.equal(guard.isCurrent(ownerA), true, 'same owner generation remains current');
guard.updateOwner('owner-a');
assert.equal(guard.isCurrent(ownerA), true, 'same owner does not invalidate in-flight work');
guard.updateOwner('owner-b');
assert.equal(guard.isCurrent(ownerA), false, 'owner switch invalidates old work immediately');
const ownerB = guard.capture();
assert.equal(guard.isCurrent(ownerB), true, 'new owner receives a current generation');
guard.updateOwner(null);
assert.equal(guard.isCurrent(ownerB), false, 'logout invalidates authenticated work');

const source = readFileSync('src/state/AppContextBase.tsx', 'utf8');
const required = [
  'syncOwnerGeneration.current.updateOwner(owner)',
  'const ownerToken = syncOwnerGeneration.current.capture()',
  'if (!syncOwnerGeneration.current.isCurrent(ownerToken) || syncConflict.current) return',
  'if (cancelled || !syncOwnerGeneration.current.isCurrent(ownerToken)) return',
  'if (!syncOwnerGeneration.current.isCurrent(ownerToken)) return',
];
for (const contract of required) {
  assert.ok(source.includes(contract), `missing owner-generation contract: ${contract}`);
}
assert.ok(
  source.indexOf('if (!syncOwnerGeneration.current.isCurrent(ownerToken)) return;\n        finishSuccessfulPush(nextState')
    > source.indexOf('const saved = await apiPutData(nextState'),
  'debounced push must validate owner after PUT before publishing success',
);
assert.ok(
  source.includes('if (!cancelled && syncOwnerGeneration.current.isCurrent(ownerToken)) setSyncReady(true)'),
  'stale startup reconciliation must not mark the next owner ready',
);
console.log('main sync owner-generation guards: ok');
