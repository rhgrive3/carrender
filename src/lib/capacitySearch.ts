import type { ISODate } from '../types';

export interface DatedCapacity {
  date: ISODate;
  minutes: number;
}

/**
 * Finds the first calendar date whose cumulative non-negative capacity reaches
 * the requested amount. The sorted prefix is built once, so the lookup is
 * O(n log n) instead of rescanning every day while the finish date advances.
 */
export function earliestDateMeetingCapacity(
  capacityByDate: ReadonlyArray<DatedCapacity>,
  start: ISODate,
  initialFinish: ISODate,
  deadline: ISODate,
  requiredMinutes: number,
): ISODate {
  if (initialFinish >= deadline || requiredMinutes <= 0) return initialFinish >= deadline ? deadline : initialFinish;
  const days = capacityByDate
    .filter((day) => day.date >= start && day.date <= deadline)
    .map((day) => ({ date: day.date, minutes: Math.max(0, day.minutes) }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const prefix = new Array<number>(days.length);
  let total = 0;
  for (let index = 0; index < days.length; index += 1) {
    total += days[index].minutes;
    prefix[index] = total;
  }
  let initialIndex = -1;
  let low = 0;
  let high = days.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (days[middle].date <= initialFinish) low = middle + 1;
    else high = middle;
  }
  initialIndex = low - 1;
  if ((initialIndex >= 0 ? prefix[initialIndex] : 0) >= requiredMinutes) return initialFinish;
  if (total < requiredMinutes) return deadline;
  low = Math.max(0, initialIndex + 1);
  high = days.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (prefix[middle] >= requiredMinutes) high = middle;
    else low = middle + 1;
  }
  return days[low]?.date ?? deadline;
}

/**
 * Returns the first value from start + k * step that satisfies a monotonic
 * predicate. If none does before max, it preserves the legacy loop contract by
 * returning the first stepped value at or above max.
 */
export function minimumFeasibleSteppedValue(
  start: number,
  max: number,
  step: number,
  predicate: (value: number) => boolean,
): number {
  if (!(step > 0) || !Number.isFinite(step)) throw new Error('step must be a positive finite number');
  if (start >= max) return start;
  const maximumIndex = Math.max(0, Math.ceil((max - start) / step));
  const maximumCandidate = start + maximumIndex * step;
  if (!predicate(maximumCandidate)) return maximumCandidate;
  let low = 0;
  let high = maximumIndex;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (predicate(start + middle * step)) high = middle;
    else low = middle + 1;
  }
  return start + low * step;
}
