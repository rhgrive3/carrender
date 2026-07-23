import assert from 'node:assert/strict';
import { earliestDateMeetingCapacity, minimumFeasibleSteppedValue } from '../src/lib/capacitySearch';
import type { ISODate } from '../src/types';
import { addDays } from '../src/lib/date';

function legacyEarliest(
  capacityByDate: ReadonlyArray<{ date: ISODate; minutes: number }>,
  start: ISODate,
  initialFinish: ISODate,
  deadline: ISODate,
  requiredMinutes: number,
): ISODate {
  let finish = initialFinish;
  const capacityThrough = (end: ISODate) => capacityByDate
    .filter((day) => day.date >= start && day.date <= end)
    .reduce((sum, day) => sum + Math.max(0, day.minutes), 0);
  while (finish < deadline && capacityThrough(finish) < requiredMinutes) finish = addDays(finish, 1);
  return finish;
}

function legacyStepped(start: number, max: number, step: number, predicate: (value: number) => boolean): number {
  let value = start;
  while (value < max && !predicate(value)) value += step;
  return value;
}

const capacities = Array.from({ length: 365 }, (_, index) => ({
  date: addDays('2026-01-01', index),
  minutes: index % 7 === 0 ? 0 : index % 11 === 0 ? -30 : 45 + (index % 5) * 15,
}));
for (const initialOffset of [0, 7, 30, 90, 180]) {
  for (const required of [0, 60, 600, 4_000, 20_000, 99_999]) {
    const initial = addDays('2026-01-01', initialOffset);
    assert.equal(
      earliestDateMeetingCapacity(capacities, '2026-01-01', initial, '2026-12-31', required),
      legacyEarliest(capacities, '2026-01-01', initial, '2026-12-31', required),
      `prefix result mismatch at offset=${initialOffset}, required=${required}`,
    );
  }
}

for (const threshold of [0, 1, 5, 140, 198, 200, 201, 500]) {
  const predicate = (value: number) => value >= threshold;
  assert.equal(
    minimumFeasibleSteppedValue(140, 200, 5, predicate),
    legacyStepped(140, 200, 5, predicate),
    `binary search mismatch for threshold=${threshold}`,
  );
}

let calls = 0;
const result = minimumFeasibleSteppedValue(0, 100_000, 5, (value) => {
  calls += 1;
  return value >= 73_210;
});
assert.equal(result, 73_210);
assert.ok(calls <= 17, `binary search used too many predicate calls: ${calls}`);

const longCapacities = Array.from({ length: 20_000 }, (_, index) => ({
  date: addDays('2026-01-01', index),
  minutes: 30,
}));
const started = performance.now();
for (let index = 0; index < 100; index += 1) {
  earliestDateMeetingCapacity(longCapacities, '2026-01-01', '2026-01-01', addDays('2026-01-01', 19_999), 450_000);
}
const elapsed = performance.now() - started;
assert.ok(elapsed < 1_500, `prefix capacity lookup exceeded budget: ${elapsed.toFixed(1)}ms`);
console.log('✅ scheduler capacity prefix sum and monotonic binary search contracts passed');
