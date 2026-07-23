import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyState, prepareImportedState } from '../src/state/AppContextBase';
import { addDays, today } from '../src/lib/date';

const currentDate = today();
const current = { ...emptyState(), onboarded: true, lastPlannedDate: currentDate };
assert.deepEqual(prepareImportedState(current, currentDate), current);
const stale = { ...current, lastPlannedDate: addDays(currentDate, -1) };
assert.equal(prepareImportedState(stale, currentDate).lastPlannedDate, currentDate);
const source = readFileSync('src/screens/SettingsSheet.tsx', 'utf8');
assert.match(source, /const appliedState = prepareImportedState\(imported\);[\s\S]{0,160}dispatch\(\{ type: 'REPLACE_STATE', state: appliedState \}\);[\s\S]{0,100}saveStateNow\(appliedState\)/u);
assert.doesNotMatch(source, /dispatch\(\{ type: 'IMPORT_STATE', state: imported \}\);[\s\S]{0,100}saveStateNow\(imported\)/u);
console.log('local JSON import persists final snapshot: ok');
