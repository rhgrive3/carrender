import type { AppState } from '../types';
import { defaultAvailability, defaultSettings } from '../data/defaults';
import { toISODate } from './date';

const KEY = 'studycommander_state_v1';
export const STATE_VERSION = 2;

export function loadState(): AppState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return normalizeState(parsed);
  } catch {
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** 書き込みはデバウンスして負荷を抑える */
export function saveState(state: AppState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.error('保存に失敗しました', e);
    }
  }, 250);
}

export function saveStateNow(state: AppState): void {
  if (saveTimer) clearTimeout(saveTimer);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('保存に失敗しました', e);
  }
}

export function clearState(): void {
  localStorage.removeItem(KEY);
}

export function exportJSON(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

export function importJSON(json: string): AppState {
  const parsed = JSON.parse(json) as AppState;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray(parsed.subjects) ||
    !Array.isArray(parsed.materials) ||
    !Array.isArray(parsed.tasks) ||
    !Array.isArray(parsed.sessions)
  ) {
    throw new Error('不正なデータ形式です');
  }
  return normalizeState(parsed);
}

export function normalizeState(input: AppState): AppState {
  const settings = { ...defaultSettings(), ...(input.settings ?? {}) };
  const availabilityDefaults = defaultAvailability();
  const availability = (Array.isArray(input.availability) && input.availability.length > 0
    ? input.availability
    : availabilityDefaults
  ).map((slot) => {
    const fallback = availabilityDefaults.find((x) => x.weekday === slot.weekday) ?? availabilityDefaults[0];
    const minutes = Number.isFinite(slot.minutes) ? Math.max(0, slot.minutes) : fallback.minutes;
    return {
      ...fallback,
      ...slot,
      minutes,
      windows:
        Array.isArray(slot.windows) && slot.windows.length > 0
          ? slot.windows.filter((w) => w.start && w.end && w.start < w.end)
          : windowsFromMinutes(slot.weekday, minutes),
    };
  });

  return {
    ...input,
    version: STATE_VERSION,
    settings,
    availability,
    dayPlans: Array.isArray(input.dayPlans)
      ? input.dayPlans.map((p) => ({
          date: p.date,
          load: p.load ?? 'normal',
          memo: p.memo ?? '',
          availabilityWindows:
            p.availabilityWindows === null
              ? null
              : Array.isArray(p.availabilityWindows)
                ? p.availabilityWindows.filter((w) => w.start && w.end && w.start < w.end)
                : null,
        }))
      : [],
    fixedEvents: Array.isArray(input.fixedEvents) ? input.fixedEvents : [],
    materials: (input.materials ?? []).map((m) => ({
      ...m,
      startDate: m.startDate ?? m.createdAt?.slice(0, 10) ?? toISODate(new Date()),
      dailyTarget: m.dailyTarget ?? null,
      weeklyTarget: m.weeklyTarget ?? null,
      phase: m.phase ?? (m.round && m.round >= 2 ? 'second' : 'first'),
      deadlinePolicy: m.deadlinePolicy ?? 'normal',
      examRelevance: m.examRelevance ?? m.priority ?? 3,
      reviewEnabled: m.reviewEnabled ?? true,
      reviewIntervals:
        Array.isArray(m.reviewIntervals) && m.reviewIntervals.length > 0
          ? m.reviewIntervals
          : settings.reviewRule.intervals,
      paused: m.paused ?? false,
      archived: m.archived ?? false,
    })),
  };
}

function windowsFromMinutes(weekday: number, minutes: number) {
  if (minutes <= 0) return [];
  const start = weekday === 0 || weekday === 6 ? 9 * 60 : 18 * 60;
  const first = Math.min(minutes, weekday === 0 || weekday === 6 ? 180 : minutes);
  const windows = [{ start: toHM(start), end: toHM(start + first) }];
  const rest = minutes - first;
  if (rest > 0) {
    const secondStart = weekday === 0 || weekday === 6 ? 14 * 60 : start + first;
    windows.push({ start: toHM(secondStart), end: toHM(secondStart + rest) });
  }
  return windows;
}

function toHM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
