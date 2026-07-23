import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareImportedState, emptyState } from '../src/state/AppContextBase';
import { addDays, today } from '../src/lib/date';

const currentDate = today();
const alreadyCurrent = {
  ...emptyState(),
  onboarded: true,
  lastPlannedDate: currentDate,
};
const preparedCurrent = prepareImportedState(alreadyCurrent, currentDate);
assert.deepEqual(preparedCurrent, alreadyCurrent, 'current cloud snapshots remain semantically unchanged');
assert.notEqual(preparedCurrent, alreadyCurrent, 'the applied snapshot is an owned copy');

const stale = {
  ...alreadyCurrent,
  lastPlannedDate: addDays(currentDate, -1),
};
const preparedStale = prepareImportedState(stale, currentDate);
assert.equal(preparedStale.lastPlannedDate, currentDate, 'stale cloud snapshots are planned before durable adoption');

const source = readFileSync('src/state/AppContextBase.tsx', 'utf8');
assert.match(source, /const appliedState = prepareImportedState\(remoteState\)[\s\S]*stateRef\.current = appliedState[\s\S]*saveStateNow\(appliedState\)[\s\S]*lastLocallyTrackedState\.current = appliedState[\s\S]*dispatch\(\{ type: 'REPLACE_STATE', state: appliedState \}\)/u, 'cloud adoption persists and renders one identical snapshot');
assert.doesNotMatch(source, /dispatch\(\{ type: 'IMPORT_STATE', state: remoteState \}\);[\s\S]{0,100}saveStateNow\(stateRef\.current\)/u, 'cloud adoption never persists the pre-dispatch local snapshot');

console.log('✅ cloud state adoption is durable before sync is marked clean');
