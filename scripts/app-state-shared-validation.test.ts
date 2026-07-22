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
assert.equal(migrateState(valid).ok, true, 'migration後に共有validatorを実行できる');

const orphanMaterial = {
  ...valid,
  materials: [{
    id: 'material-1', subjectId: 'missing-subject', name: '孤児教材', totalAmount: 10,
    doneAmount: 0, completedRanges: [], targetDate: '2026-08-01',
  }],
} as unknown as AppState;
const apiOrphan = validateAppStatePayload(orphanMaterial);
assert.equal(apiOrphan.ok, false, '未移行の孤児参照はAPIへ直接保存できない');
assert.match(apiOrphan.error ?? '', /materials.*subjectId/u);
assert.equal(migrateState(orphanMaterial).ok, true, '既存migrationで修復可能な旧参照は失わない');

const invalidSession = {
  ...valid,
  sessions: [{
    id: 'session-1', taskId: null, subjectId: 'subject-1', materialId: null,
    date: '2026-02-30', startedAt: now, minutes: 30, amountDone: 0,
  }],
} as unknown as AppState;
const apiInvalidSession = validateAppStatePayload(invalidSession);
assert.equal(apiInvalidSession.ok, false);
assert.match(apiInvalidSession.error ?? '', /sessions.*日付/u);
assert.equal(isAppStateShape(invalidSession), false, '修復不能な不正日付をlocalStorage/IndexedDB入口でも拒否する');
assert.throws(() => importJSON(JSON.stringify(invalidSession)), /sessions.*日付/u, 'JSON importへfieldとreasonを返す');

const migrationRepairable = {
  ...valid,
  goal: { id: 'goal-1', name: '医学部合格', examDate: '2026-07-31', createdAt: now },
  materials: [{
    id: 'material-1', subjectId: 'subject-1', name: '数学', totalAmount: 10,
    doneAmount: 0, completedRanges: [{ start: 1, end: 2 }], targetDate: '2026-08-31',
  }],
} as unknown as AppState;
assert.equal(validateAppStatePayload(migrationRepairable).ok, false, '未移行stateは現行validatorでは不正になり得る');
assert.equal(migrateState(migrationRepairable).ok, true, '既存migrationで修復可能な旧stateは失わない');

const storageSource = readFileSync('src/lib/storage.ts', 'utf8');
const apiSource = readFileSync('functions/api/data/v2.ts', 'utf8');
const bootstrapSource = readFileSync('src/state/MainStatePersistence.tsx', 'utf8');
assert.match(storageSource, /from '\.\.\/\.\.\/functions\/_shared\/appState'/u, '端末とAPIで同じvalidator moduleを参照する');
assert.match(storageSource, /const migrated = migrateLegacyState\(input\)[\s\S]*validateAppStatePayload\(migrated\.state\)/u, '旧stateをmigration後に現行schemaで共有検証する');
assert.match(apiSource, /validateAppStatePayload/u, 'chunk commit APIも共有validatorを維持する');
assert.match(bootstrapSource, /migrateState\(storedState\)/u, 'IndexedDB復元も共有検証を含むmigration境界を通る');

console.log('✅ shared AppState validation contracts passed');
