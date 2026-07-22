import type { AppState } from '../types';

type Snapshot = {
  owner: string | null;
  state: AppState;
};

type Listener = () => void;

let current: Snapshot | null = null;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Reactでcommit済みの現在stateだけを、DOM補助機能へ同期する。
 * localStorage・IndexedDB・cloud snapshotは画面表示のデータ源にしない。
 */
export function publishAppStateSnapshot(owner: string | null, state: AppState): void {
  if (current?.owner === owner && current.state === state) return;
  current = { owner, state };
  notify();
}

export function clearAppStateSnapshot(owner?: string | null): void {
  if (!current) return;
  if (owner !== undefined && current.owner !== owner) return;
  current = null;
  notify();
}

export function getAppStateSnapshot(): AppState | null {
  return current?.state ?? null;
}

export function subscribeAppStateSnapshot(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
