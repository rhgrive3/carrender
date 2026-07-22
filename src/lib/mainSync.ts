import type { AppState } from '../types';
import {
  MAIN_STATE_ENTITY_HASH_VERSION,
  snapshotMainStateEntityHashes,
  type MainStateEntityHashSnapshot,
  type MainStateEntityHashVersion,
} from './mainStateMerge';

const LEGACY_META_KEY = 'studycommander_main_sync_meta_v1';
const LEGACY_CONFLICT_BACKUP_KEY = 'studycommander_main_sync_conflict_backup_v1';
const META_KEY_PREFIX = 'studycommander_main_sync_meta_v2:';
const CONFLICT_BACKUP_KEY_PREFIX = 'studycommander_main_sync_conflict_backup_v2:';
export const MAIN_SYNC_METADATA_WRITE_FAILURE_EVENT = 'studycommander-main-sync-metadata-write-failure';

export interface MainSyncMetadata {
  owner: string;
  dirty: boolean;
  /** Remote version the current local edits were based on. */
  baseUpdatedAt: string | null;
  localChangedAt: string;
  /** Digest algorithm used by baseEntityHashes. */
  baseEntityHashVersion?: MainStateEntityHashVersion;
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

function ownerScopedKey(prefix: string, owner: string): string {
  return `${prefix}${encodeURIComponent(owner)}`;
}

function metadataKey(owner: string): string {
  return ownerScopedKey(META_KEY_PREFIX, owner);
}

function conflictBackupKey(owner: string): string {
  return ownerScopedKey(CONFLICT_BACKUP_KEY_PREFIX, owner);
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

function removeKey(key: string): void {
  if (!storageAvailable()) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage cleanup is best effort.
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

function isEntityHashSnapshot(value: unknown, hashPattern: RegExp): value is MainStateEntityHashSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((section) => {
    if (!section || typeof section !== 'object' || Array.isArray(section)) return false;
    return Object.values(section).every((hash) => typeof hash === 'string' && hashPattern.test(hash));
  });
}

function withoutEntityMergeBase(value: Partial<MainSyncMetadata>): MainSyncMetadata {
  const {
    baseEntityHashes: _baseEntityHashes,
    baseEntityHashVersion: _baseEntityHashVersion,
    ...metadata
  } = value;
  return metadata as MainSyncMetadata;
}

function validatedMetadata(value: Partial<MainSyncMetadata> | null): MainSyncMetadata | null {
  if (!value || typeof value.owner !== 'string' || !value.owner || typeof value.dirty !== 'boolean') return null;
  if (value.baseUpdatedAt !== null && !isIsoTimestamp(value.baseUpdatedAt)) return null;
  if (!isIsoTimestamp(value.localChangedAt)) return null;
  if (value.baseEntityHashes === undefined) {
    return value.baseEntityHashVersion === undefined ? value as MainSyncMetadata : null;
  }
  if (value.baseEntityHashVersion === MAIN_STATE_ENTITY_HASH_VERSION) {
    return isEntityHashSnapshot(value.baseEntityHashes, /^[0-9a-f]{64}$/) ? value as MainSyncMetadata : null;
  }
  // Old clients stored unversioned 32-bit FNV hashes. Keep their dirty/base
  // generation metadata, but discard the collision-prone merge base so the
  // next divergence is handled as an explicit conflict and then re-baselined.
  if (value.baseEntityHashVersion === undefined
    && isEntityHashSnapshot(value.baseEntityHashes, /^[0-9a-f]{8}$/)) {
    return withoutEntityMergeBase(value);
  }
  return null;
}

function legacyMetadata(): MainSyncMetadata | null {
  return validatedMetadata(readJSON<Partial<MainSyncMetadata>>(LEGACY_META_KEY));
}

function migrateLegacyMetadata(owner: string): MainSyncMetadata | null {
  const legacy = legacyMetadata();
  if (!legacy || legacy.owner !== owner) return null;
  if (writeJSON(metadataKey(owner), legacy)) removeKey(LEGACY_META_KEY);
  return legacy;
}

function migrateLegacyConflictBackup(owner: string): MainSyncConflictBackup | null {
  const legacy = readJSON<MainSyncConflictBackup>(LEGACY_CONFLICT_BACKUP_KEY);
  if (!legacy || legacy.owner !== owner) return null;
  if (writeJSON(conflictBackupKey(owner), legacy)) removeKey(LEGACY_CONFLICT_BACKUP_KEY);
  return legacy;
}

/** Returns only the legacy singleton entry. New metadata is account-scoped. */
export function getCurrentMainSyncMetadata(): MainSyncMetadata | null {
  return legacyMetadata();
}

export function getMainSyncMetadata(owner: string): MainSyncMetadata | null {
  const scoped = validatedMetadata(readJSON<Partial<MainSyncMetadata>>(metadataKey(owner)));
  return scoped?.owner === owner ? scoped : migrateLegacyMetadata(owner);
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
    baseEntityHashVersion: current?.baseEntityHashVersion,
    baseEntityHashes: current?.baseEntityHashes,
    localChangedAt: now,
  };
  const persisted = writeJSON(metadataKey(owner), next);
  if (persisted) {
    const legacy = legacyMetadata();
    if (legacy?.owner === owner) removeKey(LEGACY_META_KEY);
  } else {
    notifyMetadataWriteFailure(next);
  }
  return { ...next, persisted };
}

export function markMainSyncClean(
  owner: string,
  remoteUpdatedAt: string | null,
  now = new Date().toISOString(),
  cleanState?: AppState,
  throwOnFailure = true,
): MainSyncMetadataWriteResult {
  const current = getMainSyncMetadata(owner);
  const baseEntityHashes = cleanState ? snapshotMainStateEntityHashes(cleanState) : current?.baseEntityHashes;
  const next: MainSyncMetadata = {
    owner,
    dirty: false,
    baseUpdatedAt: remoteUpdatedAt,
    baseEntityHashVersion: cleanState ? MAIN_STATE_ENTITY_HASH_VERSION : current?.baseEntityHashVersion,
    baseEntityHashes,
    localChangedAt: now,
  };
  const persisted = writeJSON(metadataKey(owner), next);
  if (persisted) {
    const legacy = legacyMetadata();
    if (legacy?.owner === owner) removeKey(LEGACY_META_KEY);
  } else {
    notifyMetadataWriteFailure(next);
    if (throwOnFailure) throw new MainSyncMetadataPersistenceError(next);
  }
  return { ...next, persisted };
}

/**
 * Clears one owner's account-scoped metadata. Without an owner, only the
 * pre-v2 singleton keys are removed; account databases and resumable sync bases
 * intentionally survive logout, matching IndexedDB retention.
 */
export function clearMainSyncMetadata(owner?: string): void {
  if (!storageAvailable()) return;
  if (owner) {
    removeKey(metadataKey(owner));
    removeKey(conflictBackupKey(owner));
    const legacyMeta = legacyMetadata();
    if (legacyMeta?.owner === owner) removeKey(LEGACY_META_KEY);
    const legacyBackup = readJSON<MainSyncConflictBackup>(LEGACY_CONFLICT_BACKUP_KEY);
    if (legacyBackup?.owner === owner) removeKey(LEGACY_CONFLICT_BACKUP_KEY);
    return;
  }
  removeKey(LEGACY_META_KEY);
  removeKey(LEGACY_CONFLICT_BACKUP_KEY);
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
  const persisted = writeJSON(conflictBackupKey(backup.owner), backup);
  if (persisted) {
    const legacy = readJSON<MainSyncConflictBackup>(LEGACY_CONFLICT_BACKUP_KEY);
    if (legacy?.owner === backup.owner) removeKey(LEGACY_CONFLICT_BACKUP_KEY);
  }
  return persisted;
}

export function getMainSyncConflictBackup(owner: string): MainSyncConflictBackup | null {
  const scoped = readJSON<MainSyncConflictBackup>(conflictBackupKey(owner));
  return scoped?.owner === owner ? scoped : migrateLegacyConflictBackup(owner);
}
