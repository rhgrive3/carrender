import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Server } from 'lucide-react';
import type { MemoryConflict } from '../infrastructure/repositories';
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
  const [nextCursor, setNextCursor] = useState<string>();
  const [totalCount, setTotalCount] = useState(0);

  const load = async (append = false) => {
    if (!repository) return;
    const [page, count] = await Promise.all([
      repository.listConflictsPage(CONFLICT_PAGE_SIZE, append ? nextCursor : undefined),
      repository.countUnresolvedConflicts(),
    ]);
    const rows = append
      ? [...new Map([...conflicts, ...page.rows].map((row) => [row.id, row])).values()]
      : page.rows;
    setConflicts(rows);
    setNextCursor(page.nextCursor);
    setTotalCount(count);
    setSelectedId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id ?? '');
  };

  useEffect(() => { setNextCursor(undefined); void load(false); }, [repository]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = useMemo(() => conflicts.find((conflict) => conflict.id === selectedId), [conflicts, selectedId]);

  const resolveServer = async () => {
    if (!repository || !selected || busy) return;
    setBusy(true);
    try {
      await repository.resolveConflictWithServer(selected.id);
      await Promise.all([load(false), refresh()]);
      toast('サーバー版を採用しました');
      void requestSync(true);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '競合を解決できませんでした');
    } finally { setBusy(false); }
  };

  const resolveLocal = async () => {
    if (!repository || !selected || busy) return;
    setBusy(true);
    try {
      await repository.resolveConflictWithLocal(selected.id);
      await Promise.all([load(false), refresh()]);
      toast('ローカル版を同期待ちへ戻しました');
      void requestSync(true);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '競合を解決できませんでした');
    } finally { setBusy(false); }
  };

  return (
    <MemoryDialog title="同期差分を確認" onClose={onClose}>
      {conflicts.length === 0 ? (
        <div className="empty-state"><div className="empty-title">未解決の差分はありません</div><button type="button" className="btn btn-primary" onClick={onClose}>閉じる</button></div>
      ) : (
        <div className="memory-conflict-layout">
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
                disabled={busy}
                aria-label={`残り${totalCount - conflicts.length}件の同期競合をさらに表示`}
                onClick={() => void load(true)}
              >
                さらに表示（残り{totalCount - conflicts.length}件）
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
