import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { MemorySet, MemorySession } from '../domain/types';
import { MemoryRepository } from '../infrastructure/repositories';
import { flushMemorySync, type MemorySyncStatus } from '../infrastructure/syncEngine';

export type MemoryView =
  | { name: 'home' }
  | { name: 'set'; setId: string }
  | { name: 'editor'; setId?: string; itemId?: string; bulk?: boolean }
  | { name: 'import'; setId?: string }
  | { name: 'studySetup'; setIds: string[] }
  | { name: 'study'; sessionId: string }
  | { name: 'result'; sessionId: string }
  | { name: 'analytics'; setIds: string[] };

interface MemoryContextValue {
  repository: MemoryRepository | null;
  ready: boolean;
  error: string | null;
  sets: MemorySet[];
  activeSession: MemorySession | null;
  syncStatus: MemorySyncStatus;
  syncError: string | null;
  pendingCount: number;
  conflictCount: number;
  view: MemoryView;
  immersive: boolean;
  navigate: (view: MemoryView) => void;
  refresh: () => Promise<void>;
  requestSync: (force?: boolean) => Promise<void>;
}

const MemoryContext = createContext<MemoryContextValue | null>(null);

export function MemoryProvider({ owner, children }: { owner: string; children: ReactNode }) {
  const [repository, setRepository] = useState<MemoryRepository | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sets, setSets] = useState<MemorySet[]>([]);
  const [activeSession, setActiveSession] = useState<MemorySession | null>(null);
  const [syncStatus, setSyncStatus] = useState<MemorySyncStatus>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [view, setView] = useState<MemoryView>({ name: 'home' });
  const mounted = useRef(true);
  const activeRepository = useRef<MemoryRepository | null>(null);

  const refreshRepository = useCallback(async (target: MemoryRepository) => {
    const [nextSets, session, pending, conflicts] = await Promise.all([
      target.listSets(),
      target.getActiveSession(),
      target.pendingMutations(10_000),
      target.listConflicts(),
    ]);
    // An auth reconciliation can replace the legacy username owner with the
    // stable server user ID while an IndexedDB read is still in flight. Never
    // let that superseded repository publish another owner's stale snapshot.
    if (!mounted.current || activeRepository.current !== target) return;
    setSets(nextSets);
    setActiveSession(session ?? null);
    setPendingCount(pending.length);
    setConflictCount(conflicts.length);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const next = new MemoryRepository(owner);
    activeRepository.current = next;
    setRepository(next);
    setReady(false);
    setError(null);
    setSyncStatus('idle');
    setSyncError(null);
    void (async () => {
      // IndexedDBを開けない場合だけ暗記機能全体のエラーにする。端末データを
      // 読めた後のネットワーク・同期失敗まで致命扱いにして画面を塞がない。
      try {
        await next.clientId();
        await refreshRepository(next);
        if (mounted.current && activeRepository.current === next) setReady(true);
      } catch (caught) {
        if (mounted.current && activeRepository.current === next) {
          setError(caught instanceof Error ? caught.message : '暗記データを開けませんでした');
          setReady(true);
        }
        return;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (mounted.current && activeRepository.current === next) setSyncStatus('offline');
        return;
      }

      if (mounted.current && activeRepository.current === next) {
        setSyncStatus('syncing');
        setSyncError(null);
      }
      try {
        // Startup also drains pending offline edits and paginated remote changes.
        // Five-record transport chunks keep each Pages Function under D1 limits.
        const result = await flushMemorySync(next, 100);
        if (mounted.current && activeRepository.current === next) {
          setSyncStatus(result.status);
          setSyncError(result.errorMessage ?? null);
        }
        await refreshRepository(next);
      } catch (caught) {
        if (mounted.current && activeRepository.current === next) {
          setSyncStatus('error');
          setSyncError(caught instanceof Error ? caught.message : '暗記データを同期できませんでした');
        }
      }
    })();
    return () => {
      if (activeRepository.current === next) {
        activeRepository.current = null;
        mounted.current = false;
      }
      next.close();
    };
  }, [owner, refreshRepository]);

  const refresh = useCallback(async () => {
    if (!repository) return;
    await refreshRepository(repository);
  }, [refreshRepository, repository]);

  const requestSync = useCallback(async (force = false) => {
    if (!repository) return;
    try {
      const [unsynced, hasPendingContentMutations] = await Promise.all([
        repository.unsyncedAttempts(force ? 20 : 21),
        repository.hasPendingContentMutations(),
      ]);
      // 回答だけは20件ごとにバッチ送信する一方、カード/セットの編集は
      // 1件でも即時同期する。以前は未同期回答数だけを見ていたため、編集だけが
      // 次の回答・画面遷移まで端末に残ることがあった。
      if (!force && !hasPendingContentMutations && unsynced.length < 20) {
        await refreshRepository(repository);
        return;
      }
      setSyncStatus('syncing');
      setSyncError(null);
      const result = await flushMemorySync(repository);
      if (mounted.current && activeRepository.current === repository) {
        setSyncStatus(result.status);
        setSyncError(result.errorMessage ?? null);
      }
      await refreshRepository(repository);
    } catch (caught) {
      if (mounted.current && activeRepository.current === repository) {
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        setSyncStatus(offline ? 'offline' : 'error');
        setSyncError(offline ? null : caught instanceof Error ? caught.message : '暗記データを同期できませんでした');
      }
    }
  }, [refreshRepository, repository]);

  useEffect(() => {
    if (!repository) return;
    const onOnline = () => void requestSync(true);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void requestSync(true);
    };
    const onPageHide = () => {
      // pagehide cannot be awaited; attempts are already durable in IndexedDB.
      // A best-effort request is safe and the next launch retries remaining rows.
      void requestSync(true);
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [repository, requestSync]);

  const navigate = useCallback((next: MemoryView) => setView(next), []);
  const value = useMemo<MemoryContextValue>(() => ({
    repository,
    ready,
    error,
    sets,
    activeSession,
    syncStatus,
    syncError,
    pendingCount,
    conflictCount,
    view,
    immersive: view.name === 'study',
    navigate,
    refresh,
    requestSync,
  }), [
    repository,
    ready,
    error,
    sets,
    activeSession,
    syncStatus,
    syncError,
    pendingCount,
    conflictCount,
    view,
    navigate,
    refresh,
    requestSync,
  ]);

  return <MemoryContext.Provider value={value}>{children}</MemoryContext.Provider>;
}

export function useMemory(): MemoryContextValue {
  const value = useContext(MemoryContext);
  if (!value) throw new Error('useMemory must be used within MemoryProvider');
  return value;
}
