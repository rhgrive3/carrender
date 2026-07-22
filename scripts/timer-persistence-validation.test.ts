import assert from 'node:assert/strict';
import { normalizePersistedTimer } from '../src/components/timer/TimerContext';

const owner = 'tester';
const now = Date.UTC(2026, 6, 22, 0, 0, 0);
const target = {
  taskId: 'task-1',
  subjectId: 'subject-1',
  materialId: 'material-1',
  title: '数学',
  rangeLabel: '1〜10',
  sourceId: 'source-1',
  range: { start: 1, end: 10 },
  type: 'new',
};

const valid = {
  target,
  mode: 'stopwatch',
  workStartedAt: now - 60_000,
  runningSince: now - 30_000,
  phase: 'work',
  cycle: 0,
  phaseAccumulatedSec: 30,
  workCompletedSec: 0,
  owner,
};

const normalized = normalizePersistedTimer(valid, owner, now);
assert.equal(normalized?.target, target);
assert.equal(normalized?.mode, 'stopwatch');
assert.equal(normalized?.phase, 'work');
assert.equal(normalized?.cycle, 0);
assert.equal(normalized?.phaseAccumulatedSec, 30);
assert.equal(normalized?.workStartedAt, valid.workStartedAt);
assert.equal(normalized?.runningSince, valid.runningSince);

const legacy = {
  target,
  owner,
  runningSince: now - 10_000,
  accumulatedSec: 12,
};
const migrated = normalizePersistedTimer(legacy, owner, now);
assert.equal(migrated?.mode, 'stopwatch');
assert.equal(migrated?.phase, 'work');
assert.equal(migrated?.phaseAccumulatedSec, 12);
assert.equal(migrated?.workStartedAt, legacy.runningSince);

for (const invalid of [
  { ...valid, owner: 'other' },
  { ...valid, mode: 'invalid' },
  { ...valid, phase: 'break' },
  { ...valid, cycle: -1 },
  { ...valid, cycle: 1.5 },
  { ...valid, phaseAccumulatedSec: -1 },
  { ...valid, phaseAccumulatedSec: Number.NaN },
  { ...valid, workCompletedSec: Number.POSITIVE_INFINITY },
  { ...valid, runningSince: now + 10 * 60_000 },
  { ...valid, workStartedAt: now - 10_000, runningSince: now - 20_000 },
  { ...valid, pendingRecordMinutes: 0, runningSince: null },
  { ...valid, pendingRecordMinutes: 10, runningSince: now - 1_000 },
  { ...valid, target: { ...target, subjectId: '' } },
  { ...valid, target: { ...target, range: { start: 10, end: 1 } } },
]) {
  assert.equal(normalizePersistedTimer(invalid, owner, now), null);
}

const pending = normalizePersistedTimer(
  { ...valid, runningSince: null, pendingRecordMinutes: 10 },
  owner,
  now,
);
assert.equal(pending?.pendingRecordMinutes, 10);

console.log('timer persistence validation tests passed');
