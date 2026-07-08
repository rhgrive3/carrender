import type { ISODate, Weekday } from '../types';

/** ローカルタイムでの "YYYY-MM-DD" */
export function toISODate(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function today(): ISODate {
  return toISODate(new Date());
}

export function parseISO(date: ISODate): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = parseISO(date);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** b - a の日数 */
export function diffDays(a: ISODate, b: ISODate): number {
  const ms = parseISO(b).getTime() - parseISO(a).getTime();
  return Math.round(ms / 86400000);
}

export function weekdayOf(date: ISODate): Weekday {
  return parseISO(date).getDay() as Weekday;
}

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

export function formatDateJa(date: ISODate): string {
  const d = parseISO(date);
  return `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAY_LABELS[d.getDay()]})`;
}

export function formatDateShort(date: ISODate): string {
  const d = parseISO(date);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}時間` : `${h}時間${r}分`;
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
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

let idCounter = 0;
export function genId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}
