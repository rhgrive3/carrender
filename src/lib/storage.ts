import type { AppState } from '../types';
import { defaultAvailability, defaultSettings, defaultTimerSettings } from '../data/defaults';
import { toISODate } from './date';

const KEY = 'studycommander_state_v1';
const OWNER_KEY = 'studycommander_owner_v1';
export const STATE_VERSION = 2;

/** どのアカウントのデータがlocalStorageにキャッシュされているかを記録する(別ユーザーへの誤流用を防止) */
export function getStateOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

export function setStateOwner(owner: string | null): void {
  try {
    if (owner) localStorage.setItem(OWNER_KEY, owner);
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    // localStorageが使えなくても致命的ではない
  }
}

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

/** ログアウト時: 端末に残る学習データキャッシュと持ち主情報を消す(共用端末での漏えい防止) */
export function clearOwnedState(): void {
  localStorage.removeItem(KEY);
  localStorage.removeItem(OWNER_KEY);
}

export function exportJSON(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

/** 学習ログをExcel/スプレッドシートで開けるCSVに変換する(BOM付きUTF-8) */
export function exportSessionsCSV(state: AppState): string {
  const esc = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['日付', '開始時刻', '科目', '教材', '学習時間(分)', '進んだ量', '単位', '正答率(%)', '集中度', '記録方法', 'メモ'];
  const rows = [...state.sessions]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((s) => {
      const subject = state.subjects.find((x) => x.id === s.subjectId);
      const material = state.materials.find((x) => x.id === s.materialId);
      const time = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(s.startedAt));
      return [s.date, time, subject?.name ?? '', material?.name ?? '', s.minutes, s.amountDone || '', material?.unit ?? '', s.accuracy ?? '', s.focus ?? '', s.source === 'timer' ? 'タイマー' : '手入力', s.memo]
        .map(esc)
        .join(',');
    });
  return '﻿' + [header.join(','), ...rows].join('\r\n');
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
  const timerDefaults = defaultTimerSettings();
  const settings = {
    ...defaultSettings(),
    ...(input.settings ?? {}),
    // v2以前の保存データにはtimer/weeklyTargetMinutesがないため深いレベルで補完する
    weeklyTargetMinutes: Math.max(0, input.settings?.weeklyTargetMinutes ?? 0),
    timer: {
      ...timerDefaults,
      ...(input.settings?.timer ?? {}),
      pomodoro: { ...timerDefaults.pomodoro, ...(input.settings?.timer?.pomodoro ?? {}) },
    },
  };
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
    fixedEvents: Array.isArray(input.fixedEvents)
      ? input.fixedEvents.map((e) => ({
          ...e,
          startDate: e.startDate ?? null,
          endDate: e.endDate ?? null,
        }))
      : [],
    materials: (input.materials ?? []).map((m) => ({
      ...m,
      startDate: m.startDate ?? m.createdAt?.slice(0, 10) ?? toISODate(new Date()),
      dailyTarget: m.dailyTarget ?? null,
      weeklyTarget: m.weeklyTarget ?? null,
      phase: m.phase ?? (m.round && m.round >= 2 ? 'second' : 'first'),
      deadlinePolicy: m.deadlinePolicy ?? 'normal',
      examRelevance: m.examRelevance ?? m.priority ?? 3,
      reviewEnabled: m.reviewEnabled ?? false,
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
