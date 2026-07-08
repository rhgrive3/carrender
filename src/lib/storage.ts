import type { AppState } from '../types';

const KEY = 'studycommander_state_v1';
export const STATE_VERSION = 1;

export function loadState(): AppState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (parsed.version !== STATE_VERSION) {
      // 将来のマイグレーション用フック。現状はv1のみ。
      return null;
    }
    return parsed;
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
  parsed.version = STATE_VERSION;
  return parsed;
}
