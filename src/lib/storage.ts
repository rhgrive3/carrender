import type { AppState, TimeRange, ValidationIssue } from '../types';
import { defaultAvailability, defaultSettings, defaultTimerSettings } from '../data/defaults';
import { toISODate } from './date';
import { clearMainSyncMetadata } from './mainSync';

const KEY = 'studycommander_state_v1';
const OWNER_KEY = 'studycommander_owner_v1';
const BACKUP_KEY = 'studycommander_state_migration_backup';
const TIMER_KEY = 'studycommander_timer_v1';
const UPDATED_KEY = 'studycommander_state_updated_at_v1';
/**
 * v6: v5に加え、旧データで教材期限が単一目標日を越えている場合は、
 * 教材期限を失わないよう目標日を最新の使用中教材期限まで延長する。
 */
export const STATE_VERSION = 6;


export function isAppStateShape(value: unknown): value is AppState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<Record<keyof AppState, unknown>>;
  return typeof candidate.onboarded === 'boolean'
    && Array.isArray(candidate.subjects)
    && Array.isArray(candidate.materials)
    && Array.isArray(candidate.tasks)
    && (candidate.planHistory === undefined || Array.isArray(candidate.planHistory))
    && Array.isArray(candidate.sessions)
    && (candidate.availability === undefined || Array.isArray(candidate.availability))
    && (candidate.dayPlans === undefined || Array.isArray(candidate.dayPlans))
    && (candidate.fixedEvents === undefined || Array.isArray(candidate.fixedEvents))
    && !!candidate.settings
    && typeof candidate.settings === 'object'
    && !Array.isArray(candidate.settings);
}


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
    const parsed: unknown = JSON.parse(raw);
    if (!isAppStateShape(parsed)) return null;
    try {
      const migration = migrateState(parsed);
      if (!migration.ok) {
        localStorage.setItem(BACKUP_KEY, raw);
        console.error('一部の保存データに移行エラーがあります', migration.errors);
        // 正規化済みの壊れた状態を通常保存すると、次回には元データを
        // 復旧できなくなる。バックアップだけ残して通常起動を止める。
        return null;
      }
      return migration.state;
    } catch (error) {
      localStorage.setItem(BACKUP_KEY, raw);
      console.error('保存データの移行に失敗しました。元データをバックアップしました', error);
      return null;
    }
  } catch {
    return null;
  }
}


export interface StateSaveFailure {
  message: string;
  at: string;
}

type StateSaveFailureListener = (failure: StateSaveFailure | null) => void;
const stateSaveFailureListeners = new Set<StateSaveFailureListener>();
let currentStateSaveFailure: StateSaveFailure | null = null;

export function subscribeStateSaveFailure(listener: StateSaveFailureListener): () => void {
  stateSaveFailureListeners.add(listener);
  listener(currentStateSaveFailure);
  return () => stateSaveFailureListeners.delete(listener);
}

function publishStateSaveFailure(failure: StateSaveFailure | null): void {
  currentStateSaveFailure = failure;
  for (const listener of stateSaveFailureListeners) listener(failure);
}

function saveSerialized(state: AppState): void {
  localStorage.setItem(KEY, JSON.stringify(state));
  localStorage.setItem(UPDATED_KEY, new Date().toISOString());
  publishStateSaveFailure(null);
}

function reportStateSaveFailure(error: unknown): void {
  console.error('保存に失敗しました', error);
  const quota = error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
  publishStateSaveFailure({
    message: quota
      ? '端末保存容量を超えました。ページを閉じる前にJSONを書き出してください'
      : '端末への保存に失敗しました。ページを閉じる前に同期またはJSON書き出しを確認してください',
    at: new Date().toISOString(),
  });
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** 書き込みはデバウンスして負荷を抑える */
export function saveState(state: AppState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      saveSerialized(state);
    } catch (e) {
      reportStateSaveFailure(e);
    }
  }, 250);
}

export function saveStateNow(state: AppState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    saveSerialized(state);
  } catch (e) {
    reportStateSaveFailure(e);
  }
}

/** ログアウト時: 端末に残る学習データキャッシュと持ち主情報を消す(共用端末での漏えい防止) */
export function clearOwnedState(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(UPDATED_KEY);
    localStorage.removeItem(OWNER_KEY);
    localStorage.removeItem(TIMER_KEY);
    localStorage.removeItem(BACKUP_KEY);
  } catch {
    // Storage APIが拒否されても、認証側のログアウト処理は継続させる。
  }
  clearMainSyncMetadata();
}

export function exportJSON(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

/** 学習ログをExcel/スプレッドシートで開けるCSVに変換する(BOM付きUTF-8) */
export function exportSessionsCSV(state: AppState): string {
  const esc = (v: string | number | null) => {
    let s = v === null ? '' : String(v);
    // Excel等が先頭記号を数式として評価するCSV注入を防ぐ。
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['日付', '開始時刻', '科目', '教材', '学習時間(分)', '進んだ量', '単位', '集中度', '記録方法', 'メモ'];
  const rows = [...state.sessions]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((s) => {
      const subject = state.subjects.find((x) => x.id === s.subjectId);
      const material = state.materials.find((x) => x.id === s.materialId);
      const time = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(s.startedAt));
      return [s.date, time, subject?.name ?? '', material?.name ?? '', s.minutes, s.amountDone || '', material?.unit ?? '', s.focus ?? '', s.source === 'timer' ? 'タイマー' : '手入力', s.memo]
        .map(esc)
        .join(',');
    });
  return '﻿' + [header.join(','), ...rows].join('\r\n');
}

export function importJSON(json: string): AppState {
  const parsed: unknown = JSON.parse(json);
  if (!isAppStateShape(parsed)) throw new Error('不正なデータ形式です');
  const migration = migrateState(parsed);
  if (!migration.ok) throw new Error(`移行できない項目があります: ${migration.errors.map((error) => `${error.targetId}.${error.field}`).join(', ')}`);
  return migration.state;
}

export type MigrationResult =
  | { ok: true; state: AppState; errors: [] }
  | { ok: false; state: AppState; errors: ValidationIssue[] };

export function migrateState(input: AppState): MigrationResult {
  const state = normalizeState(input);
  const errors: ValidationIssue[] = [];
  for (const material of state.materials) {
    const source = input.materials?.find((item) => item.id === material.id);
    const total = material.totalUnits ?? material.totalAmount;
    if ((source?.doneAmount ?? 0) > total) {
      errors.push({ targetId: material.id, field: 'doneAmount', value: source?.doneAmount, reason: '完了量が教材総量を超えています', suggestion: '教材総量または完了量を修正してください' });
    }
    const invalidRange = source?.completedRanges?.find((range) =>
      !Number.isInteger(range.start)
      || !Number.isInteger(range.end)
      || range.start < 1
      || range.end < range.start
      || range.end > total,
    );
    if (invalidRange) {
      errors.push({
        targetId: material.id,
        field: 'completedRanges',
        value: invalidRange,
        reason: '教材の完了範囲が総量外または不正です',
        suggestion: `1から${total}までの正しい範囲へ修正してください`,
      });
    }
  }
  return errors.length > 0 ? { ok: false, state, errors } : { ok: true, state, errors: [] };
}

export function normalizeState(input: AppState): AppState {
  const timerDefaults = defaultTimerSettings();
  const rawSettings = (input.settings ?? {}) as AppState['settings'] & { timezone?: unknown };
  const { timezone: _legacyTimezone, ...inputSettings } = rawSettings;
  const settings = {
    ...defaultSettings(),
    ...inputSettings,
    // v2以前の保存データにはtimer/weeklyTargetMinutesがないため深いレベルで補完する
    weeklyTargetMinutes: Math.max(0, input.settings?.weeklyTargetMinutes ?? 0),
    reviewRule: {
      enabled: input.settings?.reviewRule?.enabled ?? defaultSettings().reviewRule.enabled,
      intervals:
        Array.isArray(input.settings?.reviewRule?.intervals) && input.settings.reviewRule.intervals.length > 0
          ? input.settings.reviewRule.intervals
          : defaultSettings().reviewRule.intervals,
    },
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
    const rawMinutes = Number.isFinite(slot.minutes) ? Math.max(0, Math.floor(slot.minutes)) : fallback.minutes;
    const windows = sanitizeTimeRanges(slot.windows, windowsFromMinutes(slot.weekday, rawMinutes));
    // 曜日別の分数は設定画面で時間帯から自動計算される派生値。以前は
    // windowsが正しく残っていても平日を18:00〜23:59相当の359分へ毎起動時に
    // クランプしていたため、利用可能容量が失われ週末集中と未配置を生んでいた。
    // 重複時間帯は二重計上せず、常に保存された時間帯から復元する。
    const minutes = totalTimeRangeMinutes(windows);
    return {
      ...fallback,
      ...slot,
      minutes,
      windows,
    };
  });
  const rawSubjects = Array.isArray(input.subjects) ? input.subjects : [];
  // 旧・破損データに参照だけ残っている場合も、存在しないsubjectIdを放置せず
  // 既存データを消さない受け皿へ寄せる。
  const hasSubjectReferences = (input.materials?.length ?? 0) > 0 || (input.tasks?.length ?? 0) > 0 || (input.sessions?.length ?? 0) > 0;
  const subjects = rawSubjects.length > 0 || !hasSubjectReferences
    ? rawSubjects
    : [{ id: 'subject_recovered', name: '未分類', color: '#6366f1', importance: 3 as const, weakness: 3 as const }];
  const validSubjectIds = new Set(subjects.map((subject) => subject.id));
  const fallbackSubjectId = subjects[0]?.id;
  const normalizeSubjectId = (candidate: string) => validSubjectIds.has(candidate) || !fallbackSubjectId ? candidate : fallbackSubjectId;
  const activeMaterialTargets = (input.materials ?? [])
    .filter((material) => material.archived !== true && validISODate(material.targetDate))
    .map((material) => material.targetDate)
    .sort();
  const latestActiveMaterialTarget = activeMaterialTargets[activeMaterialTargets.length - 1];
  // v5で追加した「教材期限 <= 目標日」の不変条件より前のデータには、
  // すでに目標日より後の教材が存在し得る。教材の期限を勝手に短縮せず、
  // 単一目標の方を延長して計画・D1同期を継続可能にする。
  const goal = input.goal && latestActiveMaterialTarget && latestActiveMaterialTarget > input.goal.examDate
    ? { ...input.goal, examDate: latestActiveMaterialTarget }
    : input.goal;

  return {
    ...input,
    version: STATE_VERSION,
    schemaVersion: STATE_VERSION,
    settings,
    goal,
    subjects,
    availability,
    dayPlans: normalizeDayPlans(input.dayPlans),
    fixedEvents: normalizeFixedEvents(input.fixedEvents),
    materials: (input.materials ?? []).map((m) => ({
      ...m,
      subjectId: normalizeSubjectId(m.subjectId),
      totalUnits: m.totalUnits ?? m.totalAmount,
      completedRanges: normalizeCompletedRanges(
        Array.isArray(m.completedRanges)
          ? m.completedRanges
          : m.doneAmount > 0
            ? [{ start: 1, end: m.doneAmount }]
            : [],
      ),
      doneAmount: rangeLength(
        normalizeCompletedRanges(
          Array.isArray(m.completedRanges)
            ? m.completedRanges
            : m.doneAmount > 0
              ? [{ start: 1, end: m.doneAmount }]
              : [],
        ),
      ),
      startDate: m.startDate ?? m.createdAt?.slice(0, 10) ?? toISODate(new Date()),
      dailyTarget: m.dailyTarget ?? null,
      weeklyTarget: m.weeklyTarget ?? null,
      deadlinePolicy: m.deadlinePolicy ?? 'normal',
      examRelevance: m.examRelevance ?? m.priority ?? 3,
      reviewEnabled: m.reviewEnabled ?? false,
      reviewIntervals:
        Array.isArray(m.reviewIntervals) && m.reviewIntervals.length > 0
          ? m.reviewIntervals
          : settings.reviewRule.intervals,
      paused: m.paused ?? false,
      archived: m.archived ?? false,
      unitStep: m.unitStep ?? 1,
      splittable: m.splittable ?? true,
      preferredCadence: m.preferredCadence ?? { type: 'auto' },
      estimateMode: m.estimateMode ?? 'suggest',
    })),
    // 廃止した「間違い直し」タスクは復習タスクとして読み替える
    tasks: (input.tasks ?? []).map((rawTask) => {
      const t = (rawTask.type as string) === 'correction' ? { ...rawTask, type: 'review' as const } : rawTask;
      const placementLock = t.placementLock
        ?? (t.manualScheduling?.placementPolicy === 'fixedTime'
          ? 'time'
          : t.manualScheduling?.placementPolicy === 'fixedDateFlexibleTime'
            ? 'date'
            : 'none');
      const hasFiniteRange = Number.isFinite(t.rangeStart) && Number.isFinite(t.rangeEnd);
      return {
        ...t,
        subjectId: normalizeSubjectId(t.subjectId),
        sourceType: t.sourceType ?? (t.generatedBy === 'manual' ? 'manual' : t.type === 'review' ? 'review' : 'material'),
        sourceId: t.sourceId ?? t.materialId ?? t.id,
        placementLock,
        placementStatus: t.placementStatus ?? (t.scheduledStart && t.scheduledEnd ? 'scheduled' : 'unscheduled'),
        materialRange:
          t.materialRange ?? (hasFiniteRange ? { start: t.rangeStart!, end: t.rangeEnd! } : undefined),
        updatedAt: t.updatedAt ?? t.createdAt,
      };
    }),
    planHistory: normalizePlanHistory(input.planHistory, normalizeSubjectId),
    sessions: (input.sessions ?? []).map((session) => ({
      ...session,
      subjectId: normalizeSubjectId(session.subjectId),
      taskSnapshotBefore: session.taskSnapshotBefore
        ? { ...session.taskSnapshotBefore, subjectId: normalizeSubjectId(session.taskSnapshotBefore.subjectId) }
        : undefined,
    })),
    lastScheduleResult: input.lastScheduleResult ?? null,
    lastPlanReason: input.lastPlanReason ?? null,
  };
}

function normalizeDayPlans(value: AppState['dayPlans'] | undefined): AppState['dayPlans'] {
  if (!Array.isArray(value)) return [];
  const byDate = new Map<string, AppState['dayPlans'][number]>();
  for (const plan of value) {
    if (!plan || !validISODate(plan.date)) continue;
    byDate.set(plan.date, {
      date: plan.date,
      load: plan.load ?? 'normal',
      memo: typeof plan.memo === 'string' ? plan.memo : '',
      availabilityWindows:
        plan.availabilityWindows === null
          ? null
          : Array.isArray(plan.availabilityWindows)
            ? sanitizeTimeRanges(plan.availabilityWindows, [])
            : null,
    });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeFixedEvents(value: AppState['fixedEvents'] | undefined): AppState['fixedEvents'] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, AppState['fixedEvents'][number]>();
  for (const event of value) {
    if (!event
      || typeof event.id !== 'string'
      || event.id.trim().length === 0
      || typeof event.title !== 'string'
      || event.title.trim().length === 0
      || !validTimeRange(event.start, event.end)) continue;
    const date = event.date === null || event.date === undefined ? null : event.date;
    const weekday = event.weekday === null || event.weekday === undefined ? null : event.weekday;
    const startDate = event.startDate === null || event.startDate === undefined ? null : event.startDate;
    const endDate = event.endDate === null || event.endDate === undefined ? null : event.endDate;
    const hasDate = date !== null;
    const hasWeekday = weekday !== null;
    const hasStartDate = startDate !== null;
    const hasEndDate = endDate !== null;
    if (hasDate && !validISODate(date)) continue;
    if (hasWeekday && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)) continue;
    if (hasStartDate !== hasEndDate
      || (hasStartDate && (!validISODate(startDate) || !validISODate(endDate) || startDate > endDate))) continue;
    if (!hasDate && !hasWeekday && !hasStartDate) continue;
    byId.set(event.id, {
      ...event,
      title: event.title.trim(),
      date,
      weekday,
      startDate,
      endDate,
    });
  }
  return [...byId.values()];
}

function normalizePlanHistory(
  value: AppState['planHistory'] | undefined,
  normalizeSubjectId: (subjectId: string) => string,
): NonNullable<AppState['planHistory']> {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, NonNullable<AppState['planHistory']>[number]>();
  for (const entry of value) {
    if (!entry
      || typeof entry.id !== 'string'
      || entry.id.trim().length === 0
      || typeof entry.taskId !== 'string'
      || entry.taskId.trim().length === 0
      || typeof entry.subjectId !== 'string'
      || typeof entry.title !== 'string'
      || entry.title.trim().length === 0
      || !validISODate(entry.scheduledDate)
      || !Number.isFinite(entry.estimatedMinutes)
      || entry.estimatedMinutes <= 0
      || !Number.isFinite(entry.amount)
      || entry.amount < 0
      || !Number.isFinite(Date.parse(entry.capturedAt))
      || entry.outcome !== 'missed') continue;
    const hasRangeStart = entry.rangeStart !== null && entry.rangeStart !== undefined;
    const hasRangeEnd = entry.rangeEnd !== null && entry.rangeEnd !== undefined;
    if (hasRangeStart !== hasRangeEnd
      || (hasRangeStart && (!Number.isFinite(entry.rangeStart)
        || !Number.isFinite(entry.rangeEnd)
        || entry.rangeStart! < 1
        || entry.rangeEnd! < entry.rangeStart!))) continue;
    if (entry.materialRange
      && (!Number.isInteger(entry.materialRange.start)
        || !Number.isInteger(entry.materialRange.end)
        || entry.materialRange.start < 1
        || entry.materialRange.end < entry.materialRange.start)) continue;
    byId.set(entry.id, {
      ...entry,
      title: entry.title.trim(),
      subjectId: normalizeSubjectId(entry.subjectId),
    });
  }
  return [...byId.values()];
}

function normalizeCompletedRanges(ranges: { start: number; end: number }[]) {
  const sorted = ranges
    .map((range) => ({ start: range.start, end: range.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 1) last.end = Math.max(last.end, range.end);
    else merged.push(range);
  }
  return merged;
}

function rangeLength(ranges: { start: number; end: number }[]) {
  return ranges.reduce((sum, range) => sum + Math.max(0, range.end - range.start + 1), 0);
}

function validISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)) return false;
  return true;
}

function validTimeRange(start: unknown, end: unknown): start is string {
  return validTime(start) && validTime(end) && start < end;
}

function totalTimeRangeMinutes(ranges: TimeRange[]): number {
  const numeric = ranges
    .map((range) => ({ start: timeValue(range.start), end: timeValue(range.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let total = 0;
  let current: { start: number; end: number } | undefined;
  for (const range of numeric) {
    if (!current) current = { ...range };
    else if (range.start <= current.end) current.end = Math.max(current.end, range.end);
    else {
      total += current.end - current.start;
      current = { ...range };
    }
  }
  return total + (current ? current.end - current.start : 0);
}

function timeValue(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function sanitizeTimeRanges(value: unknown, fallback: TimeRange[]): TimeRange[] {
  if (!Array.isArray(value)) return fallback;
  const ranges = value
    .filter((entry): entry is TimeRange => !!entry && typeof entry === 'object'
      && validTimeRange((entry as TimeRange).start, (entry as TimeRange).end))
    .map((entry) => ({ start: entry.start, end: entry.end }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  return ranges.length > 0 || value.length === 0 ? ranges : fallback;
}

function maximumGeneratedMinutes(weekday: number): number {
  return weekday === 0 || weekday === 6
    ? (12 * 60 - 9 * 60) + (24 * 60 - 1 - 14 * 60)
    : 24 * 60 - 1 - 18 * 60;
}

function windowsFromMinutes(weekday: number, rawMinutes: number): TimeRange[] {
  let minutes = Math.max(0, Math.min(maximumGeneratedMinutes(weekday), Math.floor(rawMinutes)));
  if (minutes <= 0) return [];
  if (weekday !== 0 && weekday !== 6) {
    return [{ start: '18:00', end: toHM(18 * 60 + minutes) }];
  }
  const windows: TimeRange[] = [];
  const morning = Math.min(minutes, 180);
  if (morning > 0) windows.push({ start: '09:00', end: toHM(9 * 60 + morning) });
  minutes -= morning;
  const afternoon = Math.min(minutes, 24 * 60 - 1 - 14 * 60);
  if (afternoon > 0) windows.push({ start: '14:00', end: toHM(14 * 60 + afternoon) });
  return windows;
}

function toHM(minutes: number): string {
  const bounded = Math.max(0, Math.min(24 * 60 - 1, Math.floor(minutes)));
  const h = Math.floor(bounded / 60);
  const m = bounded % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
