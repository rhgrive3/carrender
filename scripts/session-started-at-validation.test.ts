import assert from 'node:assert/strict';
import { validateAppStatePayload } from '../functions/_shared/appState';

function state(startedAt: unknown, includeStartedAt = true) {
  const session: Record<string, unknown> = {
    id: 'session',
    subjectId: 'subject',
    materialId: null,
    taskId: null,
    date: '2026-07-17',
    minutes: 30,
    amountDone: 1,
  };
  if (includeStartedAt) session.startedAt = startedAt;
  return {
    version: 6,
    schemaVersion: 6,
    onboarded: true,
    settings: {},
    goal: null,
    subjects: [{ id: 'subject', name: '数学' }],
    materials: [],
    tasks: [],
    sessions: [session],
  };
}

assert.equal(validateAppStatePayload(state('2026-07-17T04:00:00.000Z')).ok, true, '正規ISO日時を受理する');
assert.equal(validateAppStatePayload(state(undefined, false)).ok, false, 'startedAt欠落を拒否する');
assert.equal(validateAppStatePayload(state(12345)).ok, false, '非文字列startedAtを拒否する');
assert.equal(validateAppStatePayload(state('not-a-date')).ok, false, '解釈不能なstartedAtを拒否する');
assert.equal(validateAppStatePayload(state('2026-07-17')).ok, false, '日付だけのstartedAtを拒否する');
assert.equal(validateAppStatePayload(state('2026-07-17T13:00:00+09:00')).ok, false, '非正規表現の同一時刻を拒否する');

console.log('✅ session startedAt validation regressions passed');
