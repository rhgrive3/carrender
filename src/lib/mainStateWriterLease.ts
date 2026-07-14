const LEASE_PREFIX = 'studycommander_main_writer_lease_v1:';
export const MAIN_STATE_WRITER_LEASE_CHANGED_EVENT = 'studycommander-main-writer-lease-changed';
export const MAIN_STATE_WRITER_LEASE_MS = 15_000;
export const MAIN_STATE_WRITER_HEARTBEAT_MS = 5_000;

export interface MainStateWriterLease {
  owner: string;
  holderId: string;
  acquiredAt: number;
  expiresAt: number;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

const holderId = randomId();

function storage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function keyFor(owner: string): string {
  return `${LEASE_PREFIX}${owner.normalize('NFKC')}`;
}

export function parseMainStateWriterLease(raw: string | null): MainStateWriterLease | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<MainStateWriterLease>;
    if (typeof value.owner !== 'string'
      || typeof value.holderId !== 'string'
      || !Number.isFinite(value.acquiredAt)
      || !Number.isFinite(value.expiresAt)) return null;
    return value as MainStateWriterLease;
  } catch {
    return null;
  }
}

export function mayAcquireMainStateWriterLease(
  current: MainStateWriterLease | null,
  owner: string,
  candidateHolderId: string,
  now: number,
): boolean {
  return !current
    || current.owner !== owner
    || current.holderId === candidateHolderId
    || current.expiresAt <= now;
}

function notify(owner: string, active: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(MAIN_STATE_WRITER_LEASE_CHANGED_EVENT, {
    detail: { owner, active },
  }));
}

export function currentMainStateWriterHolderId(): string {
  return holderId;
}

export function readMainStateWriterLease(owner: string, store: StorageLike | null = storage()): MainStateWriterLease | null {
  if (!store || !owner.trim()) return null;
  return parseMainStateWriterLease(store.getItem(keyFor(owner)));
}

export function ensureMainStateWriterLease(
  owner: string,
  now = Date.now(),
  store: StorageLike | null = storage(),
  candidateHolderId = holderId,
): boolean {
  if (!owner.trim()) return false;
  // localStorage unavailable: there is no shared tab state, so do not block saving.
  if (!store) return true;
  const current = readMainStateWriterLease(owner, store);
  if (!mayAcquireMainStateWriterLease(current, owner, candidateHolderId, now)) return false;
  const next: MainStateWriterLease = {
    owner,
    holderId: candidateHolderId,
    acquiredAt: current?.holderId === candidateHolderId ? current.acquiredAt : now,
    expiresAt: now + MAIN_STATE_WRITER_LEASE_MS,
  };
  try {
    store.setItem(keyFor(owner), JSON.stringify(next));
    const verified = readMainStateWriterLease(owner, store);
    const active = verified?.holderId === candidateHolderId && (verified?.expiresAt ?? 0) > now;
    if (candidateHolderId === holderId) notify(owner, active);
    return active;
  } catch {
    return true;
  }
}

export function hasMainStateWriterLease(
  owner: string,
  now = Date.now(),
  store: StorageLike | null = storage(),
  candidateHolderId = holderId,
): boolean {
  if (!store) return true;
  const lease = readMainStateWriterLease(owner, store);
  return lease?.holderId === candidateHolderId && lease.expiresAt > now;
}

export function releaseMainStateWriterLease(
  owner: string,
  store: StorageLike | null = storage(),
  candidateHolderId = holderId,
): void {
  if (!store || !owner.trim()) return;
  const current = readMainStateWriterLease(owner, store);
  if (current?.holderId !== candidateHolderId) return;
  try {
    store.removeItem(keyFor(owner));
    if (candidateHolderId === holderId) notify(owner, false);
  } catch {
    // Best effort during pagehide.
  }
}
