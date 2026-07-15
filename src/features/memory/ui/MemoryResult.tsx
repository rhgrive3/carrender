import { useEffect, useMemo, useState } from 'react';
import { Home, RotateCcw, RotateCw } from 'lucide-react';
import type { MemoryAttempt, MemorySession, MemorySetBundle } from '../domain/types';
import { undoMemoryAnswer } from '../application/session';
import { useToast } from '../../../components/ui/Toast';
import { useMemory } from './MemoryContext';

export function MemoryResult({ sessionId }: { sessionId: string }) {
  const { repository, navigate, refresh, requestSync } = useMemory();
  const toast = useToast();
  const [session, setSession] = useState<MemorySession>();
  const [attempts, setAttempts] = useState<MemoryAttempt[]>([]);
  const [bundle, setBundle] = useState<MemorySetBundle>();
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    if (!repository) return;
    void (async () => {
      const loaded = await repository.getSession(sessionId);
      if (!loaded) return;
      const [rows, content] = await Promise.all([
        repository.getSessionAttempts(sessionId),
        repository.loadSetBundle(loaded.selectedSetIds),
      ]);
      setSession(loaded);
      setAttempts(rows);
      setBundle(content);
      void requestSync(true);
    })();
  }, [repository, requestSync, sessionId]);

  const counts = useMemo(() => ({
    remembered: attempts.filter((attempt) => attempt.assessment === 'correct').length,
    unsure: attempts.filter((attempt) => attempt.assessment === 'partial').length,
    missed: attempts.filter((attempt) => attempt.assessment === 'incorrect' || attempt.assessment === 'skipped').length,
  }), [attempts]);

  const needsReview = session?.needsReviewTargetIds.map((targetId) => {
    const attempt = [...attempts].reverse().find((value) => value.targetId === targetId);
    return bundle?.items.find((item) => item.id === attempt?.itemId)?.label ?? targetId;
  }) ?? [];

  const undoLast = async () => {
    if (!repository || !session || undoing) return;
    setUndoing(true);
    try {
      const restored = await undoMemoryAnswer(repository, session);
      if (!restored) {
        toast('取り消せる回答はありません');
        return;
      }
      await refresh();
      void requestSync(true);
      navigate({ name: 'study', sessionId: restored.session.id });
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '回答を取り消せませんでした');
    } finally {
      setUndoing(false);
    }
  };

  if (!session || !bundle) return <div className="card memory-loading">学習結果をまとめています…</div>;

  return (
    <section className="memory-result memory-simple-result">
      <div className="memory-result-hero">
        <span aria-hidden="true">✓</span>
        <h2>学習完了</h2>
        <p>カード {session.initialTargetIds.length}件・回答 {session.answerCount}回</p>
      </div>

      <div className="memory-simple-result-grid">
        <div className="card"><small>覚えた</small><b>{counts.remembered}</b></div>
        <div className="card"><small>あやしい</small><b>{counts.unsure}</b></div>
        <div className="card"><small>まだ</small><b>{counts.missed}</b></div>
        <div className="card"><small>次回も優先</small><b>{session.needsReviewTargetIds.length}</b></div>
      </div>

      {needsReview.length > 0 && (
        <div className="card memory-needs-review">
          <h3>次回も優先するカード</h3>
          <div>{needsReview.map((label) => <span key={label}>{label}</span>)}</div>
        </div>
      )}

      <div className="memory-result-actions">
        <button type="button" className="btn btn-ghost" onClick={() => navigate({ name: 'home' })}><Home size={18} />暗記ホーム</button>
        <button type="button" className="btn btn-ghost" disabled={undoing} onClick={() => void undoLast()}><RotateCcw size={18} />最後を取り消す</button>
        <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'studySetup', setIds: session.selectedSetIds })}><RotateCw size={18} />もう一度</button>
      </div>
    </section>
  );
}
