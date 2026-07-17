import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [loadError, setLoadError] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!repository) return;
    let cancelled = false;
    setSession(undefined);
    setAttempts([]);
    setBundle(undefined);
    setLoadError(undefined);
    void (async () => {
      const loaded = await repository.getSession(sessionId);
      if (!loaded) throw new Error('学習結果が見つかりません');
      const [rows, content] = await Promise.all([
        repository.getSessionAttempts(sessionId),
        repository.loadSetBundle(loaded.selectedSetIds),
      ]);
      if (cancelled) return;
      setSession(loaded);
      setAttempts(rows);
      setBundle(content);
      void requestSync(true).catch(() => {
        // 結果表示は端末データで継続し、同期状態は暗記ホームで再確認できる。
      });
    })().catch((caught) => {
      if (!cancelled) setLoadError(caught instanceof Error ? caught.message : '学習結果を読み込めませんでした');
    });
    return () => { cancelled = true; };
  }, [reloadKey, repository, requestSync, sessionId]);

  const counts = useMemo(() => ({
    remembered: attempts.filter((attempt) => attempt.assessment === 'correct').length,
    unsure: attempts.filter((attempt) => attempt.assessment === 'partial').length,
    missed: attempts.filter((attempt) => attempt.assessment === 'incorrect' || attempt.assessment === 'skipped').length,
  }), [attempts]);

  const needsReview = session?.needsReviewTargetIds.map((targetId) => {
    const attempt = [...attempts].reverse().find((value) => value.targetId === targetId);
    return {
      targetId,
      // 同期や編集後に元カードが消えていても、内部IDを利用者へ露出させない。
      label: bundle?.items.find((item) => item.id === attempt?.itemId)?.label ?? '削除済みカード',
    };
  }) ?? [];

  const undoLast = async () => {
    if (!repository || !session || undoing) return;
    setUndoing(true);
    try {
      const restored = await undoMemoryAnswer(repository, session);
      if (!restored) {
        if (mounted.current) toast('取り消せる回答はありません');
        return;
      }
      // 取り消しはIndexedDBへ保存済みなので、結果画面を離れた後も集計更新と
      // 端末間同期は完了させる。古い画面からのToast・状態更新・遷移だけを止める。
      await refresh();
      void requestSync(true).catch(() => {
        // 取り消し結果は端末へ保存済み。同期失敗は次回の自動同期へ委ねる。
      });
      if (!mounted.current) return;
      navigate({ name: 'study', sessionId: restored.session.id });
    } catch (caught) {
      if (mounted.current) toast(caught instanceof Error ? caught.message : '回答を取り消せませんでした');
    } finally {
      if (mounted.current) setUndoing(false);
    }
  };

  if (loadError) {
    return (
      <div className="card memory-error" role="alert">
        <h2>学習結果を開けませんでした</h2>
        <p>{loadError}</p>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={() => setReloadKey((value) => value + 1)}>再読み込み</button>
          <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'home' })}>暗記ホームへ戻る</button>
        </div>
      </div>
    );
  }
  if (!session || !bundle) return <div className="card memory-loading" role="status" aria-live="polite">学習結果をまとめています…</div>;

  return (
    <section className="memory-result memory-simple-result" aria-labelledby="memory-result-title">
      <div className="memory-result-hero">
        <span aria-hidden="true">✓</span>
        <h2 id="memory-result-title">学習完了</h2>
        <p>カード {session.initialTargetIds.length}件・回答 {session.answerCount}回</p>
      </div>

      <div className="memory-simple-result-grid" role="list" aria-label="学習結果の集計">
        <div className="card" role="listitem"><small>覚えた</small><b>{counts.remembered}</b></div>
        <div className="card" role="listitem"><small>あやしい</small><b>{counts.unsure}</b></div>
        <div className="card" role="listitem"><small>まだ</small><b>{counts.missed}</b></div>
        <div className="card" role="listitem"><small>次回も優先</small><b>{session.needsReviewTargetIds.length}</b></div>
      </div>

      {needsReview.length > 0 && (
        <div className="card memory-needs-review">
          <h3 id="memory-needs-review-title">次回も優先するカード</h3>
          <div role="list" aria-labelledby="memory-needs-review-title">
            {needsReview.map(({ targetId, label }) => <span key={targetId} role="listitem">{label}</span>)}
          </div>
        </div>
      )}

      <div className="memory-result-actions" role="group" aria-label="学習結果の操作">
        <button type="button" className="btn btn-ghost" onClick={() => navigate({ name: 'home' })}><Home size={18} aria-hidden="true" />暗記ホーム</button>
        <button type="button" className="btn btn-ghost" aria-busy={undoing} disabled={undoing || attempts.length === 0} onClick={() => void undoLast()}><RotateCcw size={18} aria-hidden="true" />{undoing ? '取り消し中…' : '最後を取り消す'}</button>
        <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'studySetup', setIds: session.selectedSetIds })}><RotateCw size={18} aria-hidden="true" />もう一度</button>
      </div>
      <span className="sr-only" role="status" aria-live="polite">{undoing ? '最後の回答を取り消しています' : ''}</span>
    </section>
  );
}
