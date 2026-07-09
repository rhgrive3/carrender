import type { ISODate } from '../types';
import { addDays, APP_TIME_ZONE, hmToMinutes, minutesToHM, toISODate } from './date';

const DAY_MINUTES = 24 * 60;
const LATEST_END_MINUTE = DAY_MINUTES - 1;

export interface NormalizedTaskSchedule {
  date: ISODate;
  startTime: string;
  endTime: string;
  adjusted: boolean;
}

interface NormalizeTaskScheduleOptions {
  now?: Date;
  timeZone?: string;
  minStartBufferMin?: number;
  defaultNextDayStart?: string;
}

function currentMinutesInTimeZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return (hour % 24) * 60 + minute;
}

function roundUpToStep(min: number, step: number): number {
  return Math.ceil(min / step) * step;
}

export function normalizeTaskSchedule(
  date: ISODate,
  startTime: string,
  minutes: number,
  options: NormalizeTaskScheduleOptions = {},
): NormalizedTaskSchedule {
  const timeZone = options.timeZone ?? APP_TIME_ZONE;
  const now = options.now ?? new Date();
  const minStartBufferMin = options.minStartBufferMin ?? 5;
  const defaultNextDayStart = options.defaultNextDayStart ?? '09:00';
  const today = toISODate(now);

  let normalizedDate = date < today ? today : date;
  if (!startTime) {
    return { date: normalizedDate, startTime: '', endTime: '', adjusted: normalizedDate !== date };
  }

  let startMin = hmToMinutes(startTime);
  const minimumStart = roundUpToStep(currentMinutesInTimeZone(now, timeZone) + minStartBufferMin, 5);

  if (date < today || (date === today && startMin < minimumStart)) {
    startMin = Math.max(startMin, minimumStart);
  }

  if (startMin >= DAY_MINUTES || startMin + minutes > LATEST_END_MINUTE) {
    normalizedDate = addDays(normalizedDate, 1);
    startMin = hmToMinutes(defaultNextDayStart);
  }

  const normalizedStartTime = minutesToHM(startMin);
  return {
    date: normalizedDate,
    startTime: normalizedStartTime,
    endTime: minutesToHM(startMin + minutes),
    adjusted: normalizedDate !== date || normalizedStartTime !== startTime,
  };
}
