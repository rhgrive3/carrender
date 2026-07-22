import type { AppState } from '../types';
import { snapshotMainStateEntityHashes, type MainStateEntityHashSnapshot } from './mainStateMerge';

const META_KEY = 'studycommander_main_sync_meta_v1';
const CONFLICT_BACKUP_KEY = 'studycommander_main_sync_conflict_backup_v1';
export const MAIN_SYNC_METADATA_WRITE_FAILURE_EVENT = 'studycommander-main-sync-metadata-write-failure';

export interface MainSyncMetadata {
  owner: string;
  dirty: boolean;
  /** Remote version the current local edits were based on. */
  baseUpdatedAt: string | null;
  localChangedAt: string;
  /** Hashes of the last clean generation, used as an entity-level merge base. */
  baseEntityHashes?: MainStateEntityHashSnapshot;
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

export interface MainSyncMetadataWriteResult extends MainSyncMetadata {
  persisted: boolean;
}

export class MainSyncMetadataPersistenceError extends Error {
  constructor(public readonly metadata: MainSyncMetadata) {
    super('同期状態を端末へ保存できませんでした');
    this.name = 'MainSyncMetadataPersistenceError';
  }
}

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

function notifyMetadataWriteFailure(metadata: MainSyncMetadata): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<MainSyncMetadata>(
    MAIN_SYNC_METADATA_WRITE_FAILURE_EVENT,
    { detail: metadata },
  ));
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isEntityHashSnapshot(value: unknown): value is MainStateEntityHashSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((section) => {
    if (!section || typeof section !== 'object' || Array.isArray(section)) return false;
    return Object.values(section).every((hash) => typeof hash === 'string' && /^[0-9a-f]{8}$/.test(hash));
  });
}

function validatedMetadata(value: Partial<MainSyncMetadata> | null): MainSyncMetadata | null {
  if (!value || typeof value.owner !== 'string' || !value.owner || typeof value.dirty !== 'boolean') return null;
  if (value.baseUpdatedAt !== null && !isIsoTimestamp(value.baseUpdatedAt)) return null;
  if (!isIsoTimestamp(value.localChangedAt)) return null;
  if (value.baseEntityHashes !== undefined && !isEntityHashSnapshot(value.baseEntityHashes)) return null;
  return value as MainSyncMetadata;
}

export function getCurrentMainSyncMetadata(): MainSyncMetadata | null {
  return validatedMetadata(readJSON<Partial<MainSyncMetadata>>(META_KEY));
}

export function getMainSyncMetadata(owner: string): MainSyncMetadata | null {
  const value = getCurrentMainSyncMetadata();
  return value?.owner === owner ? value : null;
}

/**
 * Marks the local snapshot as unsynced. Once dirty, the original base version
 * and entity hashes are preserved until a successful sync; otherwise later
 * edits or deletions could hide a genuine remote conflict.
 */
export function markMainSyncDirty(
  owner: string,
  baseUpdatedAt: string | null,
  now = new Date().toISOString(),
): MainSyncMetadataWriteResult {
  const current = getMainSyncMetadata(owner);
  const next: MainSyncMetadata = {
    owner,
    dirty: true,
    baseUpdatedAt: current?.dirty ? current.baseUpdatedAt : baseUpdatedAt,
    baseEntityHashes: current?.baseEntityHashes,
    localChangedAt: now,
  };
  const persisted = writeJSON(META_KEY, next);
  if (!persisted) notifyMetadataWriteFailure(next);
  return { ...next, persisted };
}

export function markMainSyncClean(
  owner: string,
  remoteUpdatedAt: string | null,
  now = new Date().toISOString(),
  cleanState?: AppState,
  throwOnFailure = true,
): MainSyncMetadataWriteResult {
  const next: MainSyncMetadata = {
    owner,
    dirty: false,
    baseUpdatedAt: remoteUpdatedAt,
    baseEntityHashes: cleanState ? snapshotMainStateEntityHashes(cleanState) : getMainSyncMetadata(owner)?.baseEntityHashes,
    localChangedAt: now,
  };
  const persisted = writeJSON(META_KEY, next);
  if (!persisted) {
    notifyMetadataWriteFailure(next);
    if (throwOnFailure) throw new MainSyncMetadataPersistenceError(next);
  }
  return { ...next, persisted };
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
