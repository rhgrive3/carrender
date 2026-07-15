import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AppState } from '../types';
import { AppStateIndexedDbRepository } from '../lib/appStateIndexedDb';
import { canonicalizeCloudSettings, canonicalizeSettingsWithHistory } from '../lib/appStateChunks';
import { getMainSyncMetadata, markMainSyncClean, markMainSyncDirty } from '../lib/mainSync';
import { getStateOwner, loadState, migrateState, saveStateNow, setStateOwner } from '../lib/storage';
import { useApp } from './AppContext';

function restoreSyncMetadata(owner: string, repositoryMetadata: Awaited<ReturnType<AppStateIndexedDbRepository['loadSyncMetadata']>>): void {
  if (!repositoryMetadata || repositoryMetadata.owner !== owner || getMainSyncMetadata(owner)) return;
  if (repositoryMetadata.dirty) {
    markMainSyncDirty(owner, repositoryMetadata.baseUpdatedAt, repositoryMetadata.localChangedAt);
  } else {
    markMainSyncClean(owner, repositoryMetadata.baseUpdatedAt, repositoryMetadata.localChangedAt);
  }
}

/** 未知設定だけを除去し、計画履歴など現行の端末データは保持する。 */
export function canonicalizeLocalSettings(input: AppState['settings']): AppState['settings'] {
  return canonicalizeSettingsWithHistory(input) ?? canonicalizeCloudSettings(input);
}

export interface StoredStateBaseline {
  current: AppState | null;
}

/** Advance the differential baseline only after IndexedDB committed the snapshot. */
export async function persistMainStateSnapshot(
  repository: Pick<AppStateIndexedDbRepository, 'saveState'>,
  snapshot: AppState,
  baseline: StoredStateBaseline,
): Promise<void> {
  const previous = baseline.current;
  await repository.saveState(snapshot, previous);
  baseline.current = snapshot;
}

/**
 * Restores the account-scoped IndexedDB snapshot before AppProvider starts its
 * cloud reconciliation. localStorage remains the synchronous emergency cache;
 * when it exists for this owner it wins because pagehide can update it after an
 * asynchronous IndexedDB write was suspended by iOS.
 */
export function MainStateBootstrap({ owner, children }: { owner: string; children: ReactNode }) {
  const [readyOwner, setReadyOwner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const repository = new AppStateIndexedDbRepository(owner);

    void (async () => {
      try {
        const [storedState, storedSyncMetadata] = await Promise.all([
          repository.loadState(),
          repository.loadSyncMetadata(),
        ]);
        if (cancelled) return;
        restoreSyncMetadata(owner, storedSyncMetadata);

        const cachedOwner = getStateOwner();
        const localState = cachedOwner === null || cachedOwner === owner ? loadState() : null;
        if (localState) {
          // 旧版・破損データ由来の未知設定はlocalStorageの小さい上限を圧迫する。
          // AppProviderを起動する前に未知設定だけを縮小し、計画履歴を含む現行データは保持する。
          const canonicalSettings = canonicalizeLocalSettings(localState.settings);
          const canonicalLocalState = { ...localState, settings: canonicalSettings };
          if (JSON.stringify(canonicalSettings) !== JSON.stringify(localState.settings)) {
            saveStateNow(canonicalLocalState);
          }
          if (storedState) await repository.saveState(canonicalLocalState, storedState);
          else await repository.migrateLegacyState(canonicalLocalState);
          if (cancelled) return;
          setStateOwner(owner);
        } else if (storedState) {
          const migration = migrateState(storedState);
          if (!migration.ok) throw new Error('IndexedDBから復元した予定データが不正です');
          const canonicalStoredState = {
            ...migration.state,
            settings: canonicalizeLocalSettings(migration.state.settings),
          };
          saveStateNow(canonicalStoredState);
          setStateOwner(owner);
        }
      } catch (caught) {
        if (cancelled) return;
        console.error('予定データのIndexedDB初期化に失敗しました', caught);
        setError('IndexedDBの予定データを読み込めませんでした。端末内バックアップまたはクラウドから起動します');
      } finally {
        if (!cancelled) setReadyOwner(owner);
      }
    })();

    return () => { cancelled = true; };
  }, [owner]);

  if (readyOwner !== owner) {
    return <div className="screen"><div className="card">端末の予定データを確認中…</div></div>;
  }

  return <>
    {children}
    {error && <div className="toast undo-notice" role="alert">{error}</div>}
  </>;
}

/**
 * Differentially mirrors live AppState and cloud generation metadata into the
 * normalized account database. All entity changes in one reducer snapshot are
 * committed in a single IndexedDB transaction.
 */
export function MainStatePersistence({ owner, children }: { owner: string; children: ReactNode }) {
  const { state, syncStatus, hasUnsyncedChanges } = useApp();
  const stateRef = useRef(state);
  stateRef.current = state;
  const repositoryRef = useRef<AppStateIndexedDbRepository | null>(null);
  const lastStoredState = useRef<AppState | null>(null);
  const [readyOwner, setReadyOwner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const repository = new AppStateIndexedDbRepository(owner);
    repositoryRef.current = repository;
    lastStoredState.current = null;
    setReadyOwner(null);
    setError(null);

    void repository.loadState().then(async (stored) => {
      if (cancelled) return;
      lastStoredState.current = stored;
      const current = stateRef.current;
      if (stored) await persistMainStateSnapshot(repository, current, lastStoredState);
      else {
        await repository.migrateLegacyState(current);
        lastStoredState.current = current;
      }
      if (!cancelled) setReadyOwner(owner);
    }).catch((caught) => {
      if (cancelled) return;
      console.error('予定データのIndexedDB保存開始に失敗しました', caught);
      setError('IndexedDBへの保存を開始できませんでした。端末内バックアップとクラウド同期は継続します');
      setReadyOwner(owner);
    });

    return () => {
      cancelled = true;
      if (repositoryRef.current === repository) repositoryRef.current = null;
    };
  }, [owner]);

  useEffect(() => {
    const repository = repositoryRef.current;
    if (!repository || readyOwner !== owner) return;
    void persistMainStateSnapshot(repository, state, lastStoredState).then(
      () => setError(null),
      (caught) => {
        console.error('予定データのIndexedDB保存に失敗しました', caught);
        setError('IndexedDBへの保存に失敗しました。端末内バックアップとクラウド同期を確認してください');
      },
    );
  }, [owner, readyOwner, state]);

  useEffect(() => {
    const repository = repositoryRef.current;
    if (!repository || readyOwner !== owner) return;
    const metadata = getMainSyncMetadata(owner);
    if (!metadata) return;
    void repository.saveSyncMetadata(metadata).catch((caught) => {
      console.error('同期世代のIndexedDB保存に失敗しました', caught);
      setError('同期状態の端末保存に失敗しました。次回起動時に競合確認が必要になる場合があります');
    });
  }, [hasUnsyncedChanges, owner, readyOwner, syncStatus]);

  useEffect(() => {
    const persist = () => {
      const repository = repositoryRef.current;
      if (!repository || readyOwner !== owner) return;
      void persistMainStateSnapshot(repository, stateRef.current, lastStoredState).catch((caught) => {
        console.error('pagehide時のIndexedDB保存に失敗しました', caught);
      });
      const metadata = getMainSyncMetadata(owner);
      if (metadata) void repository.saveSyncMetadata(metadata);
    };
    window.addEventListener('pagehide', persist);
    return () => window.removeEventListener('pagehide', persist);
  }, [owner, readyOwner]);

  return <>
    {children}
    {error && <div className="toast undo-notice" role="alert">{error}</div>}
  </>;
}
