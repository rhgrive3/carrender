import assert from 'node:assert/strict';
import { fixedEventsOn } from '../src/lib/scheduler';
import type { AppState, FixedEvent } from '../src/types';

const event: FixedEvent = {
  id: 'ev-range',
  title: '夏期講習',
  weekday: null,
  date: null,
  startDate: '2026-07-20',
  endDate: '2026-07-23',
  start: '09:00',
  end: '16:00',
};

const state = {
  fixedEvents: [event],
} as AppState;

assert.deepEqual(fixedEventsOn(state, '2026-07-20').map((item) => item.id), ['ev-range']);
assert.deepEqual(fixedEventsOn(state, '2026-07-23').map((item) => item.id), ['ev-range']);
assert.deepEqual(fixedEventsOn(state, '2026-07-24').map((item) => item.id), []);

console.log('fixed event range test passed');
