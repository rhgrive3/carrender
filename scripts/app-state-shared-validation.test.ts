import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AppState } from '../src/types';
import { importJSON, isAppStateShape, migrateState } from '../src/lib/storage';
import { validateAppStatePayload } from '../functions/_shared/appState';

const now = '2026-07-23T00:00:00.000Z';
const valid = {
  version: 6,
  schemaVersion: 6,
  onboarded: true,
  goal: null,
  subjects: [{ id: 'subject-1', name: '数学' }],
  materials: [],
  tasks: [],
  sessions: [],
  planHistory: [],
  availability: [],
  dayPlans: [],
  fixedEvents: [],
  settings: {},
  lastReschedule: null,
  lastPlannedDate: null,
  lastScheduleResult: null,
  lastPlanReason: null,
  createdAt: now,
} as unknown as AppState;

assert.equal(validateAppStatePayload(valid).ok, true, 'API側の共有validatorが正常stateを受理する');
assert.equal(isAppStateShape(valid), true, '端末側も同じ正常stateを受理する');
assert.equal(migrateState(valid).ok, true, '共有検証後にmigrationを実行できる');

const orphanMaterial = {
  ...valid,
  materials: [{
    id: 'material-1', subjectId: 'missing-subject', name: '孤児教材', totalAmount: 10,
    doneAmount: 0, completedRanges: [], targetDate: '2026-08-01',
  }],
};
const apiOrphan = validateAppStatePayload(orphanMaterial);
assert.equal(apiOrphan.ok, false);
assert.match(apiOrphan.error ?? '', /materials.*subjectId/u);
assert.equal(isAppStateShape(orphanMaterial), false, '端末側もAPIと同じ孤児参照を拒否する');
assert.throws(() => importJSON(JSON.stringify(orphanMaterial)), /materials.*subjectId/u, 'JSON importへfieldとreasonを返す');

const invalidSession = {
  ...valid,
  sessions: [{
    id: 'session-1', taskId: null, subjectId: 'subject-1', materialId: null,
    date: '2026-02-30', startedAt: now, minutes: 30, amountDone: 0,
  }],
};
assert.equal(validateAppStatePayload(invalidSession).ok, false);
assert.equal(isAppStateShape(invalidSession), false, '不正日付をlocalStorage/IndexedDB入口でも拒否する');

const storageSource = readFileSync('src/lib/storage.ts', 'utf8');
const apiSource = readFileSync('functions/api/data/v2.ts', 'utf8');
const bootstrapSource = readFileSync('src/state/MainStatePersistence.tsx', 'utf8');
assert.match(storageSource, /from '\.\.\/\.\.\/functions\/_shared\/appState'/u, '端末とAPIで同じvalidator moduleを参照する');
assert.match(storageSource, /validateAppStatePayload\(parsed, \{ allowLegacyGoalDateOverflow: true \}\)/u, 'localStorageとJSON importをmigration前に共有検証する');
assert.match(storageSource, /validateAppStatePayload\(migrated\.state\)/u, 'migration後も現行schemaで再検証する');
assert.match(apiSource, /validateAppStatePayload/u, 'chunk commit APIも共有validatorを維持する');
assert.match(bootstrapSource, /migrateState\(storedState\)/u, 'IndexedDB復元も共有検証を含むmigration境界を通る');

console.log('✅ shared AppState validation contracts passed');
