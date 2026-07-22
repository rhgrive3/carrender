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
 * localStorage is only a synchronous emergency cache. Keep well below the
 * implementation-defined browser quota so normal app data never competes with
 * auth/sync metadata and stale snapshots cannot survive a failed replacement.
 */
export const EMERGENCY_CACHE_MAX_CHARS = 1_800_000;
let emergencyCacheSuppressed = false;
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

function isStorageQuotaError(error: unknown): boolean {
  return error instanceof DOMException
    && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

export function getStateUpdatedAt(): string | null {
  try {
    return localStorage.getItem(UPDATED_KEY);
  } catch {
    return null;
  }
}

export function clearEmergencyStateCache(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(UPDATED_KEY);
  } catch {
    // The cache is optional. IndexedDB and cloud persistence remain authoritative.
  }
}

function suppressEmergencyCache(reason: string): void {
  emergencyCacheSuppressed = true;
  clearEmergencyStateCache();
  publishStateSaveFailure(null);
  console.info(reason);
}

function saveSerialized(state: AppState): void {
  if (emergencyCacheSuppressed) return;

  const serialized = JSON.stringify(state);
  if (serialized.length > EMERGENCY_CACHE_MAX_CHARS) {
    suppressEmergencyCache('AppStateが緊急localStorageキャッシュの安全上限を超えたため、IndexedDB保存のみ継続します');
    return;
  }

  try {
    localStorage.setItem(KEY, serialized);
    localStorage.setItem(UPDATED_KEY, new Date().toISOString());
    publishStateSaveFailure(null);
  } catch (error) {
    if (isStorageQuotaError(error)) {
      suppressEmergencyCache('ブラウザのlocalStorage上限へ達したため、緊急キャッシュを解除してIndexedDB保存のみ継続します');
      return;
    }
    throw error;
  }
}

function reportStateSaveFailure(error: unknown): void {
  console.error('保存に失敗しました', error);
  publishStateSaveFailure({
    message: '端末への保存に失敗しました。ページを閉じる前に同期またはJSON書き出しを確認してください',
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
  emergencyCacheSuppressed = false;
  publishStateSaveFailure(null);
  const owner = getStateOwner();
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(UPDATED_KEY);
    localStorage.removeItem(OWNER_KEY);
    localStorage.removeItem(TIMER_KEY);
    localStorage.removeItem(BACKUP_KEY);
  } catch {
    // Storage APIが拒否されても、認証側のログアウト処理は継続させる。
  }
  if (owner) clearMainSyncMetadata(owner);
}

/**
 * 復元に必要な現在状態だけをバックアップへ含める。
 *
 * 計画の変更履歴(planRevisions)は、過去の配置をUIから復元するための端末内履歴であり、
 * 教材・現在の予定・学習記録・設定を復元するためには不要。各世代が全タスク配置を
 * 重複保持するため、JSON書き出し時だけ除外する。アプリ内の履歴やクラウド正本は変更しない。
 */
export function createBackupState(state: AppState): AppState {
  const historyData = state.settings.historyData;
  if (!historyData || historyData.planRevisions.length === 0) return state;
  return {
    ...state,
    settings: {
      ...state.settings,
      historyData: {
        ...historyData,
        planRevisions: [],
      },
    },
  };
}

export function exportJSON(state: AppState): string {
  // 人が編集する用途ではなく機械復元用なので、空白・改行も保存しない。
  return JSON.stringify(createBackupState(state));
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
  if (!isAppStateShape(parsed)) throw new Error('バックアップ形式が不正です');
  const migration = migrateState(parsed);
  if (!migration.ok) throw new Error(migration.errors.map((issue) => issue.message).join('\n'));
  return migration.state;
}

export function migrateState(input: AppState): { ok: true; state: AppState } | { ok: false; errors: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const now = new Date();
  const today = toISODate(now);
  const state = structuredClone(input);

  state.settings = {
    ...defaultSettings,
    ...state.settings,
    timer: {
      ...defaultTimerSettings,
      ...state.settings.timer,
    },
    historyData: state.settings.historyData ?? defaultSettings.historyData,
  };
  state.availability = Array.isArray(state.availability) && state.availability.length > 0
    ? state.availability
    : defaultAvailability();
  state.dayPlans = Array.isArray(state.dayPlans) ? state.dayPlans : [];
  state.fixedEvents = Array.isArray(state.fixedEvents) ? state.fixedEvents : [];
  state.planHistory = Array.isArray(state.planHistory) ? state.planHistory : [];

  const subjectIds = new Set(state.subjects.map((subject) => subject.id));
  const materialIds = new Set(state.materials.map((material) => material.id));
  for (const material of state.materials) {
    if (!subjectIds.has(material.subjectId)) errors.push({ code: 'missing_subject', message: `教材「${material.name}」の科目が見つかりません` });
  }
  for (const task of state.tasks) {
    if (!subjectIds.has(task.subjectId)) errors.push({ code: 'missing_subject', message: `タスク「${task.title}」の科目が見つかりません` });
    if (task.materialId && !materialIds.has(task.materialId)) errors.push({ code: 'missing_material', message: `タスク「${task.title}」の教材が見つかりません` });
  }
  for (const session of state.sessions) {
    if (!subjectIds.has(session.subjectId)) errors.push({ code: 'missing_subject', message: '学習記録の科目が見つかりません' });
    if (session.materialId && !materialIds.has(session.materialId)) errors.push({ code: 'missing_material', message: '学習記録の教材が見つかりません' });
  }

  const activeDeadlines = state.materials
    .filter((material) => !material.archived && material.deadline)
    .map((material) => material.deadline as string)
    .filter((deadline) => /^\d{4}-\d{2}-\d{2}$/.test(deadline));
  const latestDeadline = activeDeadlines.sort().at(-1);
  if (latestDeadline && (!state.settings.goalDate || state.settings.goalDate < latestDeadline)) {
    state.settings.goalDate = latestDeadline;
  } else if (!state.settings.goalDate || !/^\d{4}-\d{2}-\d{2}$/.test(state.settings.goalDate)) {
    state.settings.goalDate = today;
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, state };
}

export function normalizeTimeRanges(ranges: TimeRange[]): TimeRange[] {
  return ranges
    .filter((range) => /^\d{2}:\d{2}$/.test(range.start) && /^\d{2}:\d{2}$/.test(range.end) && range.start < range.end)
    .sort((a, b) => a.start.localeCompare(b.start));
}
