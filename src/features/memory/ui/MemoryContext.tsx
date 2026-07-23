import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { MemorySet, MemorySession } from '../domain/types';
import { MemoryRepository } from '../infrastructure/repositories';
import { ValidatedMemoryRepository } from '../infrastructure/validatedRepository';
import { flushMemorySync, type MemorySyncStatus } from '../infrastructure/syncEngine';
import { classifyMemorySyncError, logUnexpectedMemorySyncError } from '../infrastructure/syncError';

export type MemoryView =
  | { name: 'home' }
  | { name: 'set'; setId: string }
  | { name: 'editor'; setId?: string; itemId?: string; bulk?: boolean }
  | { name: 'import'; setId?: string }
  | { name: 'studySetup'; setIds: string[] }
  | { name: 'study'; sessionId: string }
  | { name: 'result'; sessionId: string };

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
const MEMORY_EDITOR_SELECTOR = '.memory-editor, .memory-bulk-editor';
const INTERNAL_EDITOR_POINTER_WINDOW_MS = 1_000;
// IndexedDBを開けない場合だけ暗記機能全体のエラーにする。同期失敗は端末データを使える状態のまま扱う。

function navigatorOnline(): boolean | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.onLine;
}

function classifiedSyncFailure(caught: unknown) {
  const failure = classifyMemorySyncError(caught, { navigatorOnline: navigatorOnline() });
  logUnexpectedMemorySyncError(failure, caught);
  return failure;
}

function shouldConfirmExternalMemoryNavigation(lastEditorPointerDownAt: number): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  const editor = document.querySelector<HTMLElement>(MEMORY_EDITOR_SELECTOR);
  if (!editor) return false;

  const activeElement = document.activeElement;
  const keyboardEditorAction = activeElement instanceof HTMLButtonElement && editor.contains(activeElement);
  const recentEditorPointerAction = lastEditorPointerDownAt > 0
    && performance.now() - lastEditorPointerDownAt <= INTERNAL_EDITOR_POINTER_WINDOW_MS;
  const editorSaving = editor.getAttribute('aria-busy') === 'true';

  // iOSでは別タブをタップしても入力欄へフォーカスが残る場合があるため、
  // 「activeElementがEditor内」だけでは内部操作と判定しない。
  if (keyboardEditorAction || recentEditorPointerAction || editorSaving) return false;

  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

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
  const syncInFlight = useRef<Promise<void> | null>(null);
  const syncForceQueued = useRef(false);
  const lastEditorPointerDownAt = useRef(0);

  useLayoutEffect(() => {
    activeRepository.current = null;
    syncInFlight.current = null;
    syncForceQueued.current = false;
    lastEditorPointerDownAt.current = 0;
    setRepository(null);
    setReady(false);
    setError(null);
    setSyncStatus('idle');
    setSyncError(null);
    setView({ name: 'home' });
    setSets([]);
    setActiveSession(null);
    setPendingCount(0);
    setConflictCount(0);
  }, [owner]);

  const refreshRepository = useCallback(async (target: MemoryRepository) => {
    const [nextSets, session, pending, conflicts] = await Promise.all([
      target.listSets(),
      target.getActiveSession(),
      target.countPendingMutations(),
      target.countUnresolvedConflicts(),
    ]);
    if (!mounted.current || activeRepository.current !== target) return;
    setSets(nextSets);
    setActiveSession(session ?? null);
    setPendingCount(pending);
    setConflictCount(conflicts);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const next = new ValidatedMemoryRepository(owner);
    activeRepository.current = next;
    syncInFlight.current = null;
    syncForceQueued.current = false;
    setRepository(next);
    setReady(false);
    setError(null);
    setSyncStatus('idle');
    setSyncError(null);
    void (async () => {
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

      if (mounted.current && activeRepository.current === next) {
        setSyncStatus('syncing');
        setSyncError(null);
      }
      try {
        // navigator.onLine is only a display/error-classification hint. Safari can
        // report false while the request is viable, so initial sync must still try.
        const result = await flushMemorySync(next, 100);
        if (mounted.current && activeRepository.current === next) {
          setSyncStatus(result.status);
          setSyncError(result.errorMessage ?? null);
        }
        await refreshRepository(next);
      } catch (caught) {
        if (mounted.current && activeRepository.current === next) {
          const failure = classifiedSyncFailure(caught);
          setSyncStatus(failure.syncStatus);
          setSyncError(failure.syncStatus === 'offline' ? null : failure.userMessage);
        }
      }
    })();
    return () => {
      if (activeRepository.current === next) {
        activeRepository.current = null;
        syncInFlight.current = null;
        syncForceQueued.current = false;
        mounted.current = false;
      }
      next.close();
    };
  }, [owner, refreshRepository]);

  const refresh = useCallback(async () => {
    if (!repository) return;
    await refreshRepository(repository);
  }, [refreshRepository, repository]);

  const requestSync = useCallback((force = false): Promise<void> => {
    if (!repository) return Promise.resolve();
    if (syncInFlight.current) {
      if (force) syncForceQueued.current = true;
      return syncInFlight.current;
    }

    const target = repository;
    const run = (async () => {
      let runForced = force;
      do {
        syncForceQueued.current = false;
        try {
          const [unsynced, hasPendingContentMutations] = await Promise.all([
            target.unsyncedAttempts(runForced ? 20 : 21),
            target.hasPendingContentMutations(),
          ]);
          if (!runForced && !hasPendingContentMutations && unsynced.length < 20) {
            await refreshRepository(target);
          } else {
            if (mounted.current && activeRepository.current === target) {
              setSyncStatus('syncing');
              setSyncError(null);
            }
            const result = await flushMemorySync(target);
            if (mounted.current && activeRepository.current === target) {
              setSyncStatus(result.status);
              setSyncError(result.errorMessage ?? null);
            }
            await refreshRepository(target);
          }
        } catch (caught) {
          if (mounted.current && activeRepository.current === target) {
            const failure = classifiedSyncFailure(caught);
            setSyncStatus(failure.syncStatus);
            setSyncError(failure.syncStatus === 'offline' ? null : failure.userMessage);
          }
        }
        runForced = syncForceQueued.current;
      } while (runForced && mounted.current && activeRepository.current === target);
    })();
    syncInFlight.current = run;
    void run.finally(() => {
      if (syncInFlight.current === run) {
        syncInFlight.current = null;
        syncForceQueued.current = false;
      }
    });
    return run;
  }, [refreshRepository, repository]);

  useEffect(() => {
    if (!repository) return;
    const onOnline = () => void requestSync(true);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void requestSync(true);
    };
    const onPageHide = () => void requestSync(true);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [repository, requestSync]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      lastEditorPointerDownAt.current = target instanceof Element && target.closest(MEMORY_EDITOR_SELECTOR)
        ? performance.now()
        : 0;
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  const navigate = useCallback((next: MemoryView) => {
    const needsConfirmation = shouldConfirmExternalMemoryNavigation(lastEditorPointerDownAt.current);
    lastEditorPointerDownAt.current = 0;
    if (needsConfirmation && !window.confirm('未保存の暗記カード入力を破棄して移動しますか？')) return;
    setView(next);
  }, []);

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
  if (!value) throw new Error('MemoryProvider is missing');
  return value;
}
