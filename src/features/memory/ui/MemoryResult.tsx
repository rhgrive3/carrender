import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Home, RotateCcw, RotateCw } from 'lucide-react';
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
      setSession(loaded); setAttempts(rows); setBundle(content);
      void requestSync(true);
    })();
  }, [repository, requestSync, sessionId]);

  const counts = useMemo(() => ({
    correct: attempts.filter((attempt) => attempt.assessment === 'correct').length,
    partial: attempts.filter((attempt) => attempt.assessment === 'partial').length,
    incorrect: attempts.filter((attempt) => attempt.assessment === 'incorrect' || attempt.assessment === 'skipped').length,
    averageMs: attempts.length === 0 ? 0 : attempts.reduce((sum, attempt) => sum + attempt.responseMs, 0) / attempts.length,
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

  if (!session || !bundle) return <div className="card memory-loading">学習結果を集計しています…</div>;

  return (
    <section className="memory-result">
      <div className="memory-result-hero">
        <span aria-hidden="true">✓</span><h2>セッション完了</h2>
        <p>{session.initialTargetIds.length}問のLearning Target・回答 {session.answerCount}回</p>
      </div>
      <div className="memory-result-grid">
        <div className="card"><small>卒業</small><b>{session.completedTargetIds.length}</b></div>
        <div className="card"><small>正解</small><b>{counts.correct}</b></div>
        <div className="card"><small>部分正解</small><b>{counts.partial}</b></div>
        <div className="card"><small>不正解</small><b>{counts.incorrect}</b></div>
        <div className="card"><small>要確認</small><b>{session.needsReviewTargetIds.length}</b></div>
        <div className="card"><small>平均回答</small><b>{(counts.averageMs / 1_000).toFixed(1)}秒</b></div>
      </div>
      {needsReview.length > 0 && <div className="card memory-needs-review"><h3>要確認</h3><p>5回以内に卒業条件へ届かなかった項目です。</p><div>{needsReview.map((label) => <span key={label}>{label}</span>)}</div></div>}
      <div className="memory-result-actions">
        <button type="button" className="btn btn-ghost" onClick={() => navigate({ name: 'home' })}><Home size={18} />暗記ホーム</button>
        <button type="button" className="btn btn-ghost" disabled={undoing} onClick={() => void undoLast()}><RotateCcw size={18} />最後の回答を取り消す</button>
        <button type="button" className="btn btn-ghost" onClick={() => navigate({ name: 'analytics', setIds: session.selectedSetIds })}><BarChart3 size={18} />苦手分析</button>
        <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'studySetup', setIds: session.selectedSetIds })}><RotateCw size={18} />もう一度</button>
      </div>
    </section>
  );
}
