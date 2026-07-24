import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Server } from 'lucide-react';
import type { MemoryConflict, MemoryRepository } from '../infrastructure/repositories';
import { useToast } from '../../../components/ui/Toast';
import { APP_TIME_ZONE } from '../../../lib/date';
import { MemoryDialog } from './MemoryDialog';
import { useMemory } from './MemoryContext';

const CONFLICT_PAGE_SIZE = 50;

function formatted(value: unknown): string {
  return value === null || value === undefined ? '（データなし）' : JSON.stringify(value, null, 2);
}

export function MemoryConflictsDialog({ onClose }: { onClose: () => void }) {
  const { repository, refresh, requestSync } = useMemory();
  const toast = useToast();
  const [conflicts, setConflicts] = useState<MemoryConflict[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [nextCursor, setNextCursor] = useState<string>();
  const [totalCount, setTotalCount] = useState(0);
  const repositoryRef = useRef(repository);
  const loadGenerationRef = useRef(0);
  const loadInFlightRef = useRef(false);
  const conflictsRef = useRef<MemoryConflict[]>([]);
  const nextCursorRef = useRef<string>();

  repositoryRef.current = repository;
  conflictsRef.current = conflicts;
  nextCursorRef.current = nextCursor;

  const loadFor = useCallback(async (actionRepository: MemoryRepository, append = false) => {
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    const generation = ++loadGenerationRef.current;
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setLoadError(undefined);
    }
    try {
      const [page, count] = await Promise.all([
        actionRepository.listConflictsPage(CONFLICT_PAGE_SIZE, append ? nextCursorRef.current : undefined),
        actionRepository.countUnresolvedConflicts(),
      ]);
      if (repositoryRef.current !== actionRepository || loadGenerationRef.current !== generation) return;
      const rows = append
        ? [...new Map([...conflictsRef.current, ...page.rows].map((row) => [row.id, row])).values()]
        : page.rows;
      setConflicts(rows);
      setNextCursor(page.nextCursor);
      setTotalCount(count);
      setLoadError(undefined);
      setSelectedId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id ?? '');
    } catch (caught) {
      if (repositoryRef.current !== actionRepository || loadGenerationRef.current !== generation) return;
      const message = caught instanceof Error ? caught.message : '同期差分を読み込めませんでした';
      setLoadError(message);
      if (append) toast(message);
    } finally {
      if (repositoryRef.current === actionRepository && loadGenerationRef.current === generation) {
        setLoading(false);
        setLoadingMore(false);
        loadInFlightRef.current = false;
      }
    }
  }, [toast]);

  useEffect(() => {
    loadGenerationRef.current += 1;
    loadInFlightRef.current = false;
    setConflicts([]);
    setSelectedId('');
    setNextCursor(undefined);
    setTotalCount(0);
    setLoadError(undefined);
    if (!repository) {
      setLoading(false);
      return;
    }
    void loadFor(repository, false);
    return () => {
      loadGenerationRef.current += 1;
      loadInFlightRef.current = false;
    };
  }, [loadFor, repository]);

  const selected = useMemo(() => conflicts.find((conflict) => conflict.id === selectedId), [conflicts, selectedId]);

  const refreshAfterResolution = async (actionRepository: MemoryRepository) => {
    await loadFor(actionRepository, false);
    try {
      await refresh();
    } catch (caught) {
      console.error('暗記競合解決後の一覧更新に失敗しました', caught);
    }
  };

  const resolveServer = async () => {
    if (!repository || !selected || busy) return;
    const actionRepository = repository;
    setBusy(true);
    try {
      await actionRepository.resolveConflictWithServer(selected.id);
      if (repositoryRef.current !== actionRepository) return;
      toast('サーバー版を採用しました');
      void requestSync(true).catch(() => undefined);
      await refreshAfterResolution(actionRepository);
    } catch (caught) {
      if (repositoryRef.current === actionRepository) toast(caught instanceof Error ? caught.message : '競合を解決できませんでした');
    } finally {
      if (repositoryRef.current === actionRepository) setBusy(false);
    }
  };

  const resolveLocal = async () => {
    if (!repository || !selected || busy) return;
    const actionRepository = repository;
    setBusy(true);
    try {
      await actionRepository.resolveConflictWithLocal(selected.id);
      if (repositoryRef.current !== actionRepository) return;
      toast('ローカル版を同期待ちへ戻しました');
      void requestSync(true).catch(() => undefined);
      await refreshAfterResolution(actionRepository);
    } catch (caught) {
      if (repositoryRef.current === actionRepository) toast(caught instanceof Error ? caught.message : '競合を解決できませんでした');
    } finally {
      if (repositoryRef.current === actionRepository) setBusy(false);
    }
  };

  return (
    <MemoryDialog title="同期差分を確認" onClose={onClose}>
      {loading ? (
        <div className="empty-state" role="status" aria-live="polite" aria-busy="true">
          <div className="empty-title">同期差分を読み込んでいます…</div>
        </div>
      ) : loadError && conflicts.length === 0 ? (
        <div className="empty-state" role="alert">
          <div className="empty-title">同期差分を読み込めませんでした</div>
          <p>{loadError}</p>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-secondary" disabled={!repository} onClick={() => repository && void loadFor(repository, false)}>再読み込み</button>
            <button type="button" className="btn btn-primary" onClick={onClose}>閉じる</button>
          </div>
        </div>
      ) : conflicts.length === 0 ? (
        <div className="empty-state"><div className="empty-title">未解決の差分はありません</div><button type="button" className="btn btn-primary" onClick={onClose}>閉じる</button></div>
      ) : (
        <div className="memory-conflict-layout" aria-busy={busy || loadingMore}>
          {loadError && <div className="memory-inline-error" role="alert">{loadError}</div>}
          <div className="memory-conflict-list" role="listbox" aria-label={`同期競合 ${conflicts.length} / ${totalCount}件`}>
            {conflicts.map((conflict) => (
              <button type="button" role="option" aria-selected={selected?.id === conflict.id} className={selected?.id === conflict.id ? 'active' : ''} key={conflict.id} onClick={() => setSelectedId(conflict.id)}>
                <b>{conflict.entityType}</b><span>{conflict.entityId}</span><small>{new Date(conflict.createdAt).toLocaleString('ja-JP', { timeZone: APP_TIME_ZONE })}</small>
              </button>
            ))}
            {nextCursor && conflicts.length < totalCount && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || loadingMore}
                aria-busy={loadingMore}
                aria-label={`残り${totalCount - conflicts.length}件の同期競合をさらに表示`}
                onClick={() => repository && void loadFor(repository, true)}
              >
                {loadingMore ? '読み込み中…' : `さらに表示（残り${totalCount - conflicts.length}件）`}
              </button>
            )}
          </div>
          {selected && (
            <div className="memory-conflict-detail">
              <div className="memory-conflict-columns">
                <section><h4><RotateCcw size={16} />端末のローカル版</h4><pre>{formatted(selected.localValue)}</pre></section>
                <section><h4><Server size={16} />サーバー版</h4><pre>{formatted(selected.serverValue)}</pre></section>
              </div>
              <div className="memory-conflict-actions">
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void resolveServer()}><Server size={17} />サーバー版を採用</button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void resolveLocal()}><RotateCcw size={17} />ローカル版を再適用</button>
              </div>
            </div>
          )}
        </div>
      )}
    </MemoryDialog>
  );
}
