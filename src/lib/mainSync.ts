import type { AppState } from '../types';

const META_KEY = 'studycommander_main_sync_meta_v1';
const CONFLICT_BACKUP_KEY = 'studycommander_main_sync_conflict_backup_v1';

export interface MainSyncMetadata {
  owner: string;
  dirty: boolean;
  /** Remote version the current local edits were based on. */
  baseUpdatedAt: string | null;
  localChangedAt: string;
}

export interface MainSyncConflictBackup {
  owner: string;
  createdAt: string;
  localBaseUpdatedAt: string | null;
  remoteUpdatedAt: string | null;
  localState: AppState;
  remoteState: AppState | null;
}

export type InitialSyncDecision = 'none' | 'useRemote' | 'pushLocal' | 'conflict';

function storageAvailable(): boolean {
  return typeof localStorage !== 'undefined';
}

function readJSON<T>(key: string): T | null {
  if (!storageAvailable()) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): boolean {
  if (!storageAvailable()) return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function getMainSyncMetadata(owner: string): MainSyncMetadata | null {
  const value = readJSON<Partial<MainSyncMetadata>>(META_KEY);
  if (!value || value.owner !== owner || typeof value.dirty !== 'boolean') return null;
  if (value.baseUpdatedAt !== null && typeof value.baseUpdatedAt !== 'string') return null;
  if (typeof value.localChangedAt !== 'string') return null;
  return value as MainSyncMetadata;
}

/**
 * Marks the local snapshot as unsynced. Once dirty, the original base version
 * is preserved until a successful sync; otherwise later edits could hide a
 * genuine remote conflict.
 */
export function markMainSyncDirty(
  owner: string,
  baseUpdatedAt: string | null,
  now = new Date().toISOString(),
): MainSyncMetadata {
  const current = getMainSyncMetadata(owner);
  const next: MainSyncMetadata = {
    owner,
    dirty: true,
    baseUpdatedAt: current?.dirty ? current.baseUpdatedAt : baseUpdatedAt,
    localChangedAt: now,
  };
  writeJSON(META_KEY, next);
  return next;
}

export function markMainSyncClean(
  owner: string,
  remoteUpdatedAt: string | null,
  now = new Date().toISOString(),
): MainSyncMetadata {
  const next: MainSyncMetadata = {
    owner,
    dirty: false,
    baseUpdatedAt: remoteUpdatedAt,
    localChangedAt: now,
  };
  writeJSON(META_KEY, next);
  return next;
}

export function clearMainSyncMetadata(): void {
  if (!storageAvailable()) return;
  try {
    localStorage.removeItem(META_KEY);
    localStorage.removeItem(CONFLICT_BACKUP_KEY);
  } catch {
    // Storage cleanup is best effort.
  }
}

export function decideInitialSync(input: {
  metadata: MainSyncMetadata | null;
  remoteUpdatedAt: string | null;
  hasRemoteState: boolean;
  hasLocalState: boolean;
}): InitialSyncDecision {
  const { metadata, remoteUpdatedAt, hasRemoteState, hasLocalState } = input;
  if (!hasRemoteState) return hasLocalState ? 'pushLocal' : 'none';
  // On the first launch after upgrading from a client that did not persist
  // sync metadata, both snapshots may contain valid edits. Never silently pick
  // the cloud copy in that one ambiguous case.
  if (!metadata) return hasLocalState ? 'conflict' : 'useRemote';
  if (!metadata.dirty) return 'useRemote';
  return metadata.baseUpdatedAt === remoteUpdatedAt ? 'pushLocal' : 'conflict';
}

export function saveMainSyncConflictBackup(backup: MainSyncConflictBackup): boolean {
  return writeJSON(CONFLICT_BACKUP_KEY, backup);
}

export function getMainSyncConflictBackup(owner: string): MainSyncConflictBackup | null {
  const value = readJSON<MainSyncConflictBackup>(CONFLICT_BACKUP_KEY);
  return value?.owner === owner ? value : null;
}
