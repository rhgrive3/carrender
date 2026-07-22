import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { MemorySet, MemorySession } from '../domain/types';
import { MemoryRepository } from '../infrastructure/repositories';
import { ValidatedMemoryRepository } from '../infrastructure/validatedRepository';
import { flushMemorySync, type MemorySyncStatus } from '../infrastructure/syncEngine';
import { classifyMemorySyncError, logUnexpectedMemorySyncError } from '../infrastructure/syncError';
import { canScheduleMemorySyncRetry, MemorySyncRetryController } from '../infrastructure/syncRetry';

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
  /** Automatic sync request. Respects an active retry backoff. */
  requestSync: (force?: boolean) => Promise<void>;
  /** Explicit user/recovery request. Cancels retry backoff and runs immediately. */
  retrySyncNow: () => Promise<void>;
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
  const syncBypassQueued = useRef(false);
  const retryController = useRef(new MemorySyncRetryController());
  const lastEditorPointerDownAt = useRef(0);

  useLayoutEffect(() => {
    retryController.current.dispose();
    activeRepository.current = null;
    syncInFlight.current = null;
    syncForceQueued.current = false;
    syncBypassQueued.current = false;
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
      target.pendingMutations(10_000),
      target.listConflicts(),
    ]);
    if (!mounted.current || activeRepository.current !== target) return;
    setSets(nextSets);
    setActiveSession(session ?? null);
    setPendingCount(pending.length);
    setConflictCount(conflicts.length);
  }, []);

  const runSyncFor = useCallback((
    target: MemoryRepository,
    force = false,
    bypassBackoff = false,
  ): Promise<void> => {
    if (!mounted.current || activeRepository.current !== target) return Promise.resolve();
    if (bypassBackoff) retryController.current.bypass();
    else if (retryController.current.isWaiting()) return Promise.resolve();

    if (syncInFlight.current) {
      if (force) syncForceQueued.current = true;
      if (bypassBackoff) syncBypassQueued.current = true;
      return syncInFlight.current;
    }

    const scheduleRetry = (retryable: boolean | undefined, retryPolicy: Parameters<MemorySyncRetryController['schedule']>[0]) => {
      if (!retryable || !canScheduleMemorySyncRetry(retryPolicy)) {
        retryController.current.markStable();
        return false;
      }
      retryController.current.schedule(retryPolicy, () => {
        if (!mounted.current || activeRepository.current !== target) return;
        void runSyncFor(target, true, false);
      });
      return true;
    };

    const run = (async () => {
      let runForced = force;
      let runBypass = bypassBackoff;
      do {
        if (runBypass) retryController.current.bypass();
        else if (retryController.current.isWaiting()) break;
        syncForceQueued.current = false;
        syncBypassQueued.current = false;
        let retryScheduled = false;

        try {
          const [unsynced, hasPendingContentMutations] = await Promise.all([
            target.unsyncedAttempts(runForced ? 20 : 21),
            target.hasPendingContentMutations(),
          ]);
          if (!runForced && !hasPendingContentMutations && unsynced.length < 20) {
            retryController.current.markStable();
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
            retryScheduled = scheduleRetry(result.retryable, result.retryPolicy);
            await refreshRepository(target);
          }
        } catch (caught) {
          const failure = classifiedSyncFailure(caught);
          if (mounted.current && activeRepository.current === target) {
            setSyncStatus(failure.syncStatus);
            setSyncError(failure.syncStatus === 'offline' ? null : failure.userMessage);
          }
          retryScheduled = scheduleRetry(failure.retryable, failure.retryPolicy);
        }

        const queuedBypass = syncBypassQueued.current;
        const queuedForce = syncForceQueued.current;
        syncBypassQueued.current = false;
        syncForceQueued.current = false;
        // Ordinary visibility/save/pagehide triggers never defeat a newly-created
        // backoff. A user action or concrete online event may explicitly bypass it.
        if (retryScheduled && !queuedBypass) break;
        runBypass = queuedBypass;
        runForced = queuedForce || queuedBypass;
      } while ((runForced || runBypass) && mounted.current && activeRepository.current === target);
    })();

    syncInFlight.current = run;
    void run.finally(() => {
      if (syncInFlight.current === run) {
        syncInFlight.current = null;
        syncForceQueued.current = false;
        syncBypassQueued.current = false;
      }
    });
    return run;
  }, [refreshRepository]);

  useEffect(() => {
    mounted.current = true;
    const next = new ValidatedMemoryRepository(owner);
    activeRepository.current = next;
    syncInFlight.current = null;
    syncForceQueued.current = false;
    syncBypassQueued.current = false;
    retryController.current.markStable();
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
      // navigator.onLine may be stale or wrong. Always let the real request
      // determine reachability, then classify the outcome for display/retry.
      await runSyncFor(next, true, false);
    })();
    return () => {
      if (activeRepository.current === next) {
        retryController.current.dispose();
        activeRepository.current = null;
        syncInFlight.current = null;
        syncForceQueued.current = false;
        syncBypassQueued.current = false;
        mounted.current = false;
      }
      next.close();
    };
  }, [owner, refreshRepository, runSyncFor]);

  const refresh = useCallback(async () => {
    if (!repository) return;
    await refreshRepository(repository);
  }, [refreshRepository, repository]);

  const requestSync = useCallback((force = false): Promise<void> => {
    if (!repository) return Promise.resolve();
    return runSyncFor(repository, force, false);
  }, [repository, runSyncFor]);

  const retrySyncNow = useCallback((): Promise<void> => {
    if (!repository) return Promise.resolve();
    return runSyncFor(repository, true, true);
  }, [repository, runSyncFor]);

  useEffect(() => {
    if (!repository) return;
    const onOnline = () => void retrySyncNow();
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
  }, [repository, requestSync, retrySyncNow]);

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
    retrySyncNow,
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
    retrySyncNow,
  ]);

  return <MemoryContext.Provider value={value}>{children}</MemoryContext.Provider>;
}

export function useMemory(): MemoryContextValue {
  const value = useContext(MemoryContext);
  if (!value) throw new Error('MemoryProvider is missing');
  return value;
}
