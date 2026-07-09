import { fixedEventsOn } from '../src/lib/scheduler';
import type { AppState, FixedEvent } from '../src/types';

const assertEqual = <T>(actual: T, expected: T, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nactual: ${JSON.stringify(actual)}\nexpected: ${JSON.stringify(expected)}`);
  }
};

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

assertEqual(fixedEventsOn(state, '2026-07-20').map((item) => item.id), ['ev-range'], '開始日では予定が見つかること');
assertEqual(fixedEventsOn(state, '2026-07-23').map((item) => item.id), ['ev-range'], '終了日では予定が見つかること');
assertEqual(fixedEventsOn(state, '2026-07-24').map((item) => item.id), [], '期間外では予定が見つからないこと');

console.log('fixed event range test passed');
