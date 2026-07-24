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
assert.equal(
  (source.match(/catch \(refreshError\) \{\n\s+if \(!syncOwnerGeneration\.current\.isCurrent\(ownerToken\)\) return;/g) ?? []).length,
  3,
  'all 409 refresh failures, including conflict resolution, are generation guarded',
);

// Conflict resolution must always publish a terminal failure state instead of remaining "syncing".
const conflictResolutionStart = source.indexOf("const resolveSyncConflict = useCallback(async (choice: 'local' | 'cloud') => {");
const conflictResolutionEnd = source.indexOf('\n  const retrySync = useCallback', conflictResolutionStart);
assert.ok(conflictResolutionStart >= 0 && conflictResolutionEnd > conflictResolutionStart, 'resolveSyncConflict source block must exist');
const conflictResolutionSource = source.slice(conflictResolutionStart, conflictResolutionEnd);
assert.ok(
  conflictResolutionSource.includes(`catch (refreshError) {
          if (!syncOwnerGeneration.current.isCurrent(ownerToken)) return;`),
  'conflict resolution must guard a failed 409 refresh against stale owners',
);
assert.ok(
  conflictResolutionSource.includes(`setSyncErrorMessage(refresh.isNetworkError ? null : refresh.message);
          setSyncStatus(refresh.isNetworkError ? 'offline' : 'error');`),
  'conflict resolution refresh failures must leave syncing and publish offline/error state',
);
assert.ok(
  conflictResolutionSource.includes('throw refreshError;'),
  'conflict resolution refresh failures must reject so the caller can keep its error Toast',
);
console.log('main sync owner-generation guards: ok');
