import type { AppState, ValidationIssue } from '../types';
import { defaultAvailability, defaultSettings, defaultTimerSettings } from '../data/defaults';
import { toISODate } from './date';
import { clearMainSyncMetadata } from './mainSync';

const KEY = 'studycommander_state_v1';
const OWNER_KEY = 'studycommander_owner_v1';
const BACKUP_KEY = 'studycommander_state_migration_backup';
const TIMER_KEY = 'studycommander_timer_v1';
const UPDATED_KEY = 'studycommander_state_updated_at_v1';
/**
 * v4: 新規StudySessionだけに進捗・タスク由来情報を追加する。旧セッションは
 * 現在の教材進捗を互換基準として保持し、推測による二重加減算をしない。
 */
export const STATE_VERSION = 4;


export function isAppStateShape(value: unknown): value is AppState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<Record<keyof AppState, unknown>>;
  return typeof candidate.onboarded === 'boolean'
    && Array.isArray(candidate.subjects)
    && Array.isArray(candidate.materials)
    && Array.isArray(candidate.tasks)
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

/** local cache が実際に最後に確定保存された時刻。クラウド起動同期の世代比較に使う。 */
export function getLocalStateUpdatedAt(): string | null {
  try { return localStorage.getItem(UPDATED_KEY); } catch { return null; }
}

function saveSerialized(state: AppState): void {
  localStorage.setItem(KEY, JSON.stringify(state));
  localStorage.setItem(UPDATED_KEY, new Date().toISOString());
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** 書き込みはデバウンスして負荷を抑える */
export function saveState(state: AppState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      saveSerialized(state);
    } catch (e) {
      console.error('保存に失敗しました', e);
    }
  }, 250);
}

export function saveStateNow(state: AppState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    saveSerialized(state);
  } catch (e) {
    console.error('保存に失敗しました', e);
  }
}

export function clearState(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  localStorage.removeItem(KEY);
  localStorage.removeItem(UPDATED_KEY);
}

/** ログアウト時: 端末に残る学習データキャッシュと持ち主情報を消す(共用端末での漏えい防止) */
export function clearOwnedState(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  localStorage.removeItem(KEY);
  localStorage.removeItem(UPDATED_KEY);
  localStorage.removeItem(OWNER_KEY);
  localStorage.removeItem(TIMER_KEY);
  localStorage.removeItem(BACKUP_KEY);
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
  const settings = {
    ...defaultSettings(),
    ...(input.settings ?? {}),
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
    const minutes = Number.isFinite(slot.minutes) ? Math.max(0, slot.minutes) : fallback.minutes;
    return {
      ...fallback,
      ...slot,
      minutes,
      windows:
        Array.isArray(slot.windows)
          ? slot.windows
          : windowsFromMinutes(slot.weekday, minutes),
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

  return {
    ...input,
    version: STATE_VERSION,
    schemaVersion: STATE_VERSION,
    settings,
    subjects,
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
                ? p.availabilityWindows
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
