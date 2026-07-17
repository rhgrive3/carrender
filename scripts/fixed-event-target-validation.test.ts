import assert from 'node:assert/strict';
import { validateAppStatePayload } from '../functions/_shared/appState';

function stateWithFixedEvent(event: Record<string, unknown>) {
  return {
    version: 4,
    schemaVersion: 4,
    isDemo: false,
    onboarded: true,
    goal: null,
    subjects: [],
    materials: [],
    tasks: [],
    sessions: [],
    availability: [],
    dayPlans: [],
    fixedEvents: [{
      id: 'event',
      title: '固定予定',
      start: '08:00',
      end: '09:00',
      ...event,
    }],
    settings: { theme: 'auto' },
    lastReschedule: null,
    lastPlannedDate: null,
  };
}

assert.equal(validateAppStatePayload(stateWithFixedEvent({
  date: '2026-07-20',
  weekday: null,
  startDate: null,
  endDate: null,
})).ok, true, '単発予定は受理する');

assert.equal(validateAppStatePayload(stateWithFixedEvent({
  date: null,
  weekday: 1,
  startDate: null,
  endDate: null,
})).ok, true, '無期限の毎週予定は受理する');

assert.equal(validateAppStatePayload(stateWithFixedEvent({
  date: null,
  weekday: 1,
  startDate: '2026-07-01',
  endDate: '2026-07-31',
})).ok, true, '期間付き毎週予定は受理する');

assert.equal(validateAppStatePayload(stateWithFixedEvent({
  date: null,
  weekday: null,
  startDate: '2026-07-01',
  endDate: '2026-07-31',
})).ok, true, '連日予定は受理する');

for (const event of [
  {
    date: '2026-07-20',
    weekday: 1,
    startDate: null,
    endDate: null,
  },
  {
    date: '2026-07-20',
    weekday: null,
    startDate: '2026-07-01',
    endDate: '2026-07-31',
  },
  {
    date: '2026-07-20',
    weekday: 1,
    startDate: '2026-07-01',
    endDate: '2026-07-31',
  },
]) {
  const result = validateAppStatePayload(stateWithFixedEvent(event));
  assert.equal(result.ok, false, '単発日付と他の対象指定を同時に受理しない');
  assert.equal(result.error, 'fixedEvents の対象日指定が競合しています');
}

console.log('✅ fixed event target validation regressions passed');
