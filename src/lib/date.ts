import type { ISODate, Weekday } from '../types';

export const APP_TIME_ZONE = 'Asia/Tokyo';

const DAY_MS = 86400000;

function partsOf(date: ISODate): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

function isValidCalendarDate(date: ISODate): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const { y, m, d } = partsOf(date);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1) return false;
  const candidate = new Date(Date.UTC(y, m - 1, d));
  return candidate.getUTCFullYear() === y && candidate.getUTCMonth() === m - 1 && candidate.getUTCDate() === d;
}

function utcMs(date: ISODate): number {
  const { y, m, d } = partsOf(date);
  return Date.UTC(y, m - 1, d);
}

function isoFromUTCDate(d: Date): ISODate {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 日本時間(Asia/Tokyo)での "YYYY-MM-DD" */
export function toISODate(d: Date, timeZone = APP_TIME_ZONE): ISODate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${day}`;
}

export function today(timeZone = APP_TIME_ZONE): ISODate {
  return toISODate(new Date(), timeZone);
}

/** 指定タイムゾーンでの0:00からの経過分。端末タイムゾーンへ依存させない。 */
export function minutesInTimeZone(date: Date, timeZone = APP_TIME_ZONE): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return (hour % 24) * 60 + minute;
}

/** 指定タイムゾーンのローカル日付・時刻を、保存用UTC ISO文字列へ変換する。 */
export function localDateTimeToISOString(date: ISODate, time: string, timeZone = APP_TIME_ZONE): string {
  if (!isValidCalendarDate(date)) throw new Error('INVALID_LOCAL_DATE');
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('INVALID_LOCAL_TIME');
  const { y, m, d } = partsOf(date);
  const [hour, minute] = time.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error('INVALID_LOCAL_TIME');
  }
  const targetAsUtc = Date.UTC(y, m - 1, d, hour, minute);
  let candidate = targetAsUtc;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const shownParts = (value: number) => {
    const parts = formatter.formatToParts(new Date(value));
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value ?? 0);
    return {
      year: part('year'),
      month: part('month'),
      day: part('day'),
      hour: part('hour') % 24,
      minute: part('minute'),
    };
  };
  // Intlから得た現地表示との差分で補正する。DST境界では一致しない現地時刻があり得るため、
  // 反復後に必ず入力値との完全一致を確認し、別時刻への暗黙補正を防ぐ。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const shown = shownParts(candidate);
    const shownAsUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute);
    const delta = targetAsUtc - shownAsUtc;
    candidate += delta;
    if (delta === 0) break;
  }
  const resolved = shownParts(candidate);
  if (resolved.year !== y || resolved.month !== m || resolved.day !== d || resolved.hour !== hour || resolved.minute !== minute) {
    throw new Error('INVALID_LOCAL_TIME');
  }
  return new Date(candidate).toISOString();
}

export function addDays(date: ISODate, days: number): ISODate {
  return isoFromUTCDate(new Date(utcMs(date) + days * DAY_MS));
}

/** b - a の日数 */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((utcMs(b) - utcMs(a)) / DAY_MS);
}

export function weekdayOf(date: ISODate): Weekday {
  return new Date(utcMs(date)).getUTCDay() as Weekday;
}

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** その日を含む週の日曜日 */
export function startOfWeek(date: ISODate): ISODate {
  return addDays(date, -weekdayOf(date));
}

/** "YYYY-MM" */
export function monthKeyOf(date: ISODate): string {
  return date.slice(0, 7);
}

export function addMonths(monthKey: string, n: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total - ny * 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function daysInMonthOf(monthKey: string): number {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  return `${y}年${m}月`;
}

/** 分を「1.5h」「45m」のようにカレンダーのマスに収まる形式へ */
export function formatMinutesCompact(min: number): string {
  const m = Math.round(min);
  if (m <= 0) return '';
  if (m < 60) return `${m}m`;
  const h = Math.round((m / 60) * 10) / 10;
  return `${h}h`;
}

export function formatDateJa(date: ISODate): string {
  const { m, d } = partsOf(date);
  return `${m}月${d}日(${WEEKDAY_LABELS[weekdayOf(date)]})`;
}

export function formatDateShort(date: ISODate): string {
  const { m, d } = partsOf(date);
  return `${m}/${d}`;
}

export function formatMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}時間` : `${h}時間${r}分`;
}

/** 小さな統計タイル用の短い表記: 「5h55m」「45分」「6h」(折り返し防止) */
export function formatMinutesTile(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h${String(r).padStart(2, '0')}m`;
}

/** 長い時間を「約N時間」に丸める(分析の大きな数値用) */
export function formatHoursShort(min: number): string {
  const h = min / 60;
  if (h < 1) return `${Math.round(min)}分`;
  if (h < 10) return `${Math.round(h * 10) / 10}時間`;
  return `${Math.round(h)}時間`;
}

export function formatHM(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** "HH:mm" → 分 */
export function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToHM(min: number): string {
  const rounded = Math.max(0, Math.round(min));
  const h = Math.floor(rounded / 60) % 24;
  const m = rounded % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

let idCounter = 0;
export function genId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}
