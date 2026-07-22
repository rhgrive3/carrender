import type { AppState } from '../types';
import { EMERGENCY_CACHE_MAX_CHARS } from './storage';

const STATE_KEY = 'studycommander_state_v1';
const UPDATED_KEY = 'studycommander_state_updated_at_v1';

export type EmergencyStateCachePhase = 'active' | 'suppressed' | 'retrying';
export type EmergencyStateCacheReason = 'oversized' | 'quota' | 'unavailable' | null;

export interface EmergencyStateCacheStatus {
  phase: EmergencyStateCachePhase;
  reason: EmergencyStateCacheReason;
  message: string | null;
  updatedAt: string | null;
}

type EmergencyStateCacheListener = (status: EmergencyStateCacheStatus) => void;

const ACTIVE_STATUS: EmergencyStateCacheStatus = {
  phase: 'active',
  reason: null,
  message: null,
  updatedAt: null,
};

let currentStatus = ACTIVE_STATUS;
const listeners = new Set<EmergencyStateCacheListener>();

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException
    && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

function publish(status: EmergencyStateCacheStatus): EmergencyStateCacheStatus {
  currentStatus = status;
  for (const listener of listeners) listener(status);
  return status;
}

function removeEmergencySnapshot(): void {
  try {
    localStorage.removeItem(STATE_KEY);
    localStorage.removeItem(UPDATED_KEY);
  } catch {
    // IndexedDB and cloud sync remain authoritative when localStorage is unavailable.
  }
}

function suppressedStatus(reason: Exclude<EmergencyStateCacheReason, null>): EmergencyStateCacheStatus {
  const message = reason === 'oversized'
    ? '端末の緊急保存用キャッシュが容量上限を超えています。通常の端末保存と同期は継続しています'
    : reason === 'quota'
      ? '端末の緊急保存用キャッシュを確保できません。通常の端末保存と同期は継続しています'
      : '端末の緊急保存用キャッシュを利用できません。通常の端末保存と同期は継続しています';
  return { phase: 'suppressed', reason, message, updatedAt: currentStatus.updatedAt };
}

export function getEmergencyStateCacheStatus(): EmergencyStateCacheStatus {
  return currentStatus;
}

export function subscribeEmergencyStateCacheStatus(listener: EmergencyStateCacheListener): () => void {
  listeners.add(listener);
  listener(currentStatus);
  return () => listeners.delete(listener);
}

/**
 * Synchronously mirrors the latest reducer snapshot for iOS pagehide recovery.
 * IndexedDB remains the authoritative local store; this only manages the existing
 * localStorage emergency snapshot and deliberately creates no additional backup.
 */
export function persistEmergencyStateCache(state: AppState): EmergencyStateCacheStatus {
  const serialized = JSON.stringify(state);
  if (serialized.length > EMERGENCY_CACHE_MAX_CHARS) {
    removeEmergencySnapshot();
    return publish(suppressedStatus('oversized'));
  }

  if (currentStatus.phase === 'suppressed') {
    publish({ ...currentStatus, phase: 'retrying', message: '端末の緊急保存用キャッシュを再試行しています' });
  }

  try {
    const updatedAt = new Date().toISOString();
    localStorage.setItem(STATE_KEY, serialized);
    localStorage.setItem(UPDATED_KEY, updatedAt);
    return publish({ phase: 'active', reason: null, message: null, updatedAt });
  } catch (error) {
    removeEmergencySnapshot();
    return publish(suppressedStatus(isQuotaError(error) ? 'quota' : 'unavailable'));
  }
}

export function resetEmergencyStateCacheStatus(): void {
  currentStatus = ACTIVE_STATUS;
  publish(currentStatus);
}
