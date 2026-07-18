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
  const activeSessionId = useRef(sessionId);
  const undoInFlightSessionId = useRef<string>();
  activeSessionId.current = sessionId;

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
    setUndoing(false);
    undoInFlightSessionId.current = undefined;
    void (async () => {
      const loadResult = async () => {
        const loaded = await repository.getSession(sessionId);
        if (!loaded) throw new Error('学習結果が見つかりません');
        const [rows, content] = await Promise.all([
          repository.getSessionAttempts(sessionId),
          repository.loadSetBundle(loaded.selectedSetIds),
        ]);
        return { loaded, rows, content };
      };

      const initial = await loadResult();
      if (cancelled) return;
      setSession(initial.loaded);
      setAttempts(initial.rows);
      setBundle(initial.content);

      try {
        await requestSync(true);
        if (cancelled) return;
        // 別端末の回答や取り消しが同期された場合、画面を開き直さなくても最新集計へ更新する。
        const synced = await loadResult();
        if (cancelled) return;
        setSession(synced.loaded);
        setAttempts(synced.rows);
        setBundle(synced.content);
      } catch {
        // 結果表示は端末データで継続し、同期状態は暗記ホームで再確認できる。
      }
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

  // 旧端末データや競合解決後に同じtargetIdが重複していても、結果画面では1件として扱う。
  const initialTargetCount = new Set(session?.initialTargetIds ?? []).size;
  const needsReview = [...new Set(session?.needsReviewTargetIds ?? [])].map((targetId) => {
    const attempt = [...attempts].reverse().find((value) => value.targetId === targetId);
    return {
      targetId,
      // 同期や編集後に元カードが消えていても、内部IDを利用者へ露出させない。
      label: bundle?.items.find((item) => item.id === attempt?.itemId)?.label ?? '削除済みカード',
    };
  });

  const undoLast = async () => {
    if (!repository || !session || undoing || undoInFlightSessionId.current === session.id) return;
    const actionSessionId = session.id;
    undoInFlightSessionId.current = actionSessionId;
    setUndoing(true);
    try {
      const restored = await undoMemoryAnswer(repository, session);
      if (!restored) {
        if (mounted.current && activeSessionId.current === actionSessionId) toast('取り消せる回答はありません');
        return;
      }
      // 取り消しはIndexedDBへ保存済みなので、結果画面を離れた後も集計更新と
      // 端末間同期は完了させる。古い画面からのToast・状態更新・遷移だけを止める。
      try {
        await refresh();
      } catch (caught) {
        console.warn('暗記結果の取り消し後に一覧を更新できませんでした', caught);
      }
      void requestSync(true).catch(() => {
        // 取り消し結果は端末へ保存済み。同期失敗は次回の自動同期へ委ねる。
      });
      if (!mounted.current || activeSessionId.current !== actionSessionId) return;
      navigate({ name: 'study', sessionId: restored.session.id });
    } catch (caught) {
      if (mounted.current && activeSessionId.current === actionSessionId) {
        toast(caught instanceof Error ? caught.message : '回答を取り消せませんでした');
      }
    } finally {
      if (undoInFlightSessionId.current === actionSessionId) undoInFlightSessionId.current = undefined;
      if (mounted.current && activeSessionId.current === actionSessionId) setUndoing(false);
    }
  };

  if (loadError) {
    return (
      <div
        className="card memory-error"
        role="alert"
        aria-atomic="true"
        aria-labelledby="memory-result-error-title"
        aria-describedby="memory-result-error-detail"
      >
        <h2 id="memory-result-error-title">学習結果を開けませんでした</h2>
        <p id="memory-result-error-detail">{loadError}</p>
        <div className="row" role="group" aria-label="読込エラーの操作" style={{ gap: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={() => setReloadKey((value) => value + 1)}>再読み込み</button>
          <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'home' })}>暗記ホームへ戻る</button>
        </div>
      </div>
    );
  }
  if (!session || !bundle) {
    return (
      <div className="card memory-loading" role="status" aria-live="polite" aria-atomic="true" aria-busy="true">
        学習結果をまとめています…
      </div>
    );
  }

  return (
    <section className="memory-result memory-simple-result" aria-labelledby="memory-result-title" aria-describedby="memory-result-summary">
      <div className="memory-result-hero">
        <span aria-hidden="true">✓</span>
        <h2 id="memory-result-title">学習完了</h2>
        <p id="memory-result-summary">カード {initialTargetCount}件・回答 {attempts.length}回</p>
      </div>

      <div className="memory-simple-result-grid" role="list" aria-label="学習結果の集計">
        <div className="card" role="listitem" aria-label={`覚えた ${counts.remembered}件`}><small>覚えた</small><b>{counts.remembered}</b></div>
        <div className="card" role="listitem" aria-label={`あやしい ${counts.unsure}件`}><small>あやしい</small><b>{counts.unsure}</b></div>
        <div className="card" role="listitem" aria-label={`まだ ${counts.missed}件`}><small>まだ</small><b>{counts.missed}</b></div>
        <div className="card" role="listitem" aria-label={`次回も優先 ${needsReview.length}件`}><small>次回も優先</small><b>{needsReview.length}</b></div>
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
