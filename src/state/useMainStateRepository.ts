import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { AppState } from '../types';
import type { MainSyncMetadata } from '../lib/mainSync';
import { AppStateIndexedDbRepository } from '../lib/appStateIndexedDb';

interface MainStateRepositoryOptions {
  /** Stable server user id when available; username is the offline fallback. */
  repositoryOwner: string | null;
  /** Username used by the existing cloud sync generation metadata. */
  syncOwner: string | null;
  state: AppState;
  stateRef: MutableRefObject<AppState>;
  restoreState: (state: AppState) => void;
  readCurrentSyncMetadata: () => MainSyncMetadata | null;
  restoreSyncMetadata: (metadata: MainSyncMetadata) => void;
  reportError: (message: string | null) => void;
}

interface MainStateRepositoryResult {
  ready: boolean;
  persistNow: (state: AppState) => Promise<void>;
  persistSyncMetadata: (metadata: MainSyncMetadata) => Promise<void>;
}

/**
 * Owns the account-scoped IndexedDB repository lifecycle.
 *
 * localStorage remains the synchronous emergency cache during the staged
 * migration. IndexedDB is hydrated before cloud reconciliation, then receives
 * differential writes in one transaction. A retained account database can
 * restore offline data after logout without exposing it to another account.
 */
export function useMainStateRepository(options: MainStateRepositoryOptions): MainStateRepositoryResult {
  const {
    repositoryOwner,
    syncOwner,
    state,
    stateRef,
    restoreState,
    readCurrentSyncMetadata,
    restoreSyncMetadata,
    reportError,
  } = options;
  const repositoryRef = useRef<AppStateIndexedDbRepository | null>(null);
  const lastPersistedState = useRef<AppState | null>(null);
  const [readyOwner, setReadyOwner] = useState<string | null>(null);
  const callbacks = useRef({ restoreState, readCurrentSyncMetadata, restoreSyncMetadata, reportError });
  callbacks.current = { restoreState, readCurrentSyncMetadata, restoreSyncMetadata, reportError };

  useEffect(() => {
    if (!repositoryOwner || !syncOwner) {
      repositoryRef.current = null;
      lastPersistedState.current = null;
      setReadyOwner(null);
      return;
    }

    let cancelled = false;
    const repository = new AppStateIndexedDbRepository(repositoryOwner);
    repositoryRef.current = repository;
    lastPersistedState.current = null;
    setReadyOwner(null);

    void (async () => {
      try {
        const [storedState, storedSyncMetadata] = await Promise.all([
          repository.loadState(),
          repository.loadSyncMetadata(),
        ]);
        if (cancelled) return;

        if (storedSyncMetadata?.owner === syncOwner && !callbacks.current.readCurrentSyncMetadata()) {
          callbacks.current.restoreSyncMetadata(storedSyncMetadata);
        }

        const current = stateRef.current;
        if (storedState && !current.onboarded) {
          callbacks.current.restoreState(storedState);
          lastPersistedState.current = stateRef.current;
        } else if (current.onboarded) {
          if (storedState) await repository.saveState(current, storedState);
          else await repository.migrateLegacyState(current);
          if (cancelled) return;
          lastPersistedState.current = current;
        } else {
          lastPersistedState.current = storedState;
        }
        callbacks.current.reportError(null);
      } catch (error) {
        if (cancelled) return;
        console.error('IndexedDBの予定データ初期化に失敗しました', error);
        callbacks.current.reportError('IndexedDBへの保存準備に失敗しました。端末内バックアップとクラウド同期は継続します');
      } finally {
        if (!cancelled) setReadyOwner(repositoryOwner);
      }
    })();

    return () => {
      cancelled = true;
      if (repositoryRef.current === repository) repositoryRef.current = null;
    };
  }, [repositoryOwner, stateRef, syncOwner]);

  const ready = repositoryOwner === null || readyOwner === repositoryOwner;

  useEffect(() => {
    const repository = repositoryRef.current;
    if (!repository || !ready) return;
    const previous = lastPersistedState.current;
    lastPersistedState.current = state;
    void repository.saveState(state, previous).then(
      () => callbacks.current.reportError(null),
      (error) => {
        console.error('IndexedDBへの予定データ保存に失敗しました', error);
        callbacks.current.reportError('IndexedDBへの保存に失敗しました。端末内バックアップとクラウド同期を確認してください');
      },
    );
  }, [ready, state]);

  const persistNow = useCallback(async (snapshot: AppState) => {
    const repository = repositoryRef.current;
    if (!repository) return;
    const previous = lastPersistedState.current;
    lastPersistedState.current = snapshot;
    try {
      await repository.saveState(snapshot, previous);
      callbacks.current.reportError(null);
    } catch (error) {
      console.error('IndexedDBへの即時保存に失敗しました', error);
      callbacks.current.reportError('IndexedDBへの保存に失敗しました。端末内バックアップとクラウド同期を確認してください');
      throw error;
    }
  }, []);

  const persistSyncMetadata = useCallback(async (metadata: MainSyncMetadata) => {
    const repository = repositoryRef.current;
    if (!repository) return;
    try {
      await repository.saveSyncMetadata(metadata);
    } catch (error) {
      console.error('IndexedDBへの同期状態保存に失敗しました', error);
      callbacks.current.reportError('同期状態の端末保存に失敗しました。次回起動時に競合確認が必要になる場合があります');
    }
  }, []);

  return { ready, persistNow, persistSyncMetadata };
}
