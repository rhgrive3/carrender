import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Home, RotateCcw, RotateCw } from 'lucide-react';
import type { MemoryAttempt, MemorySession, MemorySetBundle } from '../domain/types';
import { primaryEnglishForSense } from '../domain/cardIntegrity';
import { undoMemoryAnswer } from '../application/session';
import { useToast } from '../../../components/ui/Toast';
import { useMemory } from './MemoryContext';

export interface MemoryCardOutcomeCounts {
  remembered: number;
  unsure: number;
  missed: number;
}

/**
 * 回答回数ではなく、一意targetのセッション最終状態を集計する。
 * graduated / needs_reviewを優先し、壊れた旧データで未分類targetが残る場合も
 * 最終回答から一度だけ分類する。
 */
export function summarizeMemoryCardOutcomes(
  session: Pick<MemorySession, 'initialTargetIds' | 'completedTargetIds' | 'needsReviewTargetIds'>,
  attempts: MemoryAttempt[],
): MemoryCardOutcomeCounts {
  const initial = [...new Set(session.initialTargetIds)];
  const completed = new Set(session.completedTargetIds);
  const needsReview = new Set(session.needsReviewTargetIds);
  const latest = new Map<string, MemoryAttempt>();
  for (const attempt of attempts) latest.set(attempt.targetId, attempt);

  let remembered = 0;
  let unsure = 0;
  let missed = 0;
  for (const targetId of initial) {
    if (completed.has(targetId)) {
      remembered += 1;
      continue;
    }
    const last = latest.get(targetId);
    if (needsReview.has(targetId)) {
      if (last?.assessment === 'incorrect' || last?.assessment === 'skipped') missed += 1;
      else unsure += 1;
      continue;
    }
    if (last?.assessment === 'correct') remembered += 1;
    else if (last?.assessment === 'partial') unsure += 1;
    else missed += 1;
  }
  return { remembered, unsure, missed };
}

/** 結果画面では親Itemではなく、実際に回答したSenseの日本語・英語ペアを示す。 */
export function memoryReviewCardLabel(bundle: MemorySetBundle | undefined, attempt: MemoryAttempt | undefined): string {
  if (!bundle || !attempt) return '削除済みカード';
  const sense = bundle.senses.find((value) => value.id === attempt.senseId);
  if (!sense) return '削除済みカード';
  const japanese = [sense.promptJa, sense.meaningJa]
    .map((value) => value.trim())
    .find(Boolean) ?? '日本語未設定';
  const english = primaryEnglishForSense(bundle, sense.id, { verifiedOnly: true })
    ?? '英語表現が未設定です';
  return `${japanese} — ${english}`;
}

export function MemoryResult({ sessionId }: { sessionId: string }) {
  const { repository, navigate, refresh, requestSync } = useMemory();
  const toast = useToast();
  const [session, setSession] = useState<MemorySession>();
  const [attempts, setAttempts] = useState<MemoryAttempt[]>([]);
  const [bundle, setBundle] = useState<MemorySetBundle>();
  const [undoing, setUndoing] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [syncingResult, setSyncingResult] = useState(false);
  const [syncWarning, setSyncWarning] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);
  const mounted = useRef(true);
  const activeSessionId = useRef(sessionId);
  const undoInFlightSessionId = useRef<string>();
  const undoActionToken = useRef(0);
  activeSessionId.current = sessionId;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useLayoutEffect(() => {
    undoActionToken.current += 1;
    setSession(undefined);
    setAttempts([]);
    setBundle(undefined);
    setLoadError(undefined);
    setSyncingResult(false);
    setSyncWarning(undefined);
    setUndoing(false);
    undoInFlightSessionId.current = undefined;
  }, [reloadKey, repository, sessionId]);

  useEffect(() => {
    if (!repository) return;
    let cancelled = false;
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

      const applyResult = (result: Awaited<ReturnType<typeof loadResult>>) => {
        if (result.loaded.status === 'active') {
          navigate({ name: 'study', sessionId: result.loaded.id });
          return false;
        }
        if (result.loaded.status !== 'completed') throw new Error('この学習セッションは終了済みです');
        setSession(result.loaded);
        setAttempts(result.rows);
        setBundle(result.content);
        return true;
      };

      const initial = await loadResult();
      if (cancelled) return;
      if (!applyResult(initial)) return;

      setSyncWarning(undefined);
      setSyncingResult(true);
      try {
        await requestSync(true);
        if (cancelled || undoInFlightSessionId.current === sessionId) return;
        const synced = await loadResult();
        if (cancelled || undoInFlightSessionId.current === sessionId) return;
        applyResult(synced);
      } catch {
        if (!cancelled) {
          setSyncWarning('端末の結果を表示しています。同期は暗記ホームから再試行できます。');
        }
      } finally {
        if (!cancelled) setSyncingResult(false);
      }
    })().catch((caught) => {
      if (!cancelled) setLoadError(caught instanceof Error ? caught.message : '学習結果を読み込めませんでした');
    });
    return () => { cancelled = true; };
  }, [navigate, reloadKey, repository, requestSync, sessionId]);

  const counts = useMemo(
    () => session ? summarizeMemoryCardOutcomes(session, attempts) : { remembered: 0, unsure: 0, missed: 0 },
    [attempts, session],
  );
  const initialTargetCount = new Set(session?.initialTargetIds ?? []).size;
  const needsReview = [...new Set(session?.needsReviewTargetIds ?? [])].map((targetId) => {
    const attempt = [...attempts].reverse().find((value) => value.targetId === targetId);
    return {
      targetId,
      label: memoryReviewCardLabel(bundle, attempt),
    };
  });

  const undoLast = async () => {
    if (!repository || !session || undoing || undoInFlightSessionId.current === session.id) return;
    const actionSessionId = session.id;
    const actionRepository = repository;
    const actionToken = ++undoActionToken.current;
    undoInFlightSessionId.current = actionSessionId;
    setUndoing(true);
    const isCurrentAction = () => (
      mounted.current
      && activeSessionId.current === actionSessionId
      && repository === actionRepository
      && undoActionToken.current === actionToken
    );
    try {
      const restored = await undoMemoryAnswer(actionRepository, session);
      if (!restored) {
        if (isCurrentAction()) toast('取り消せる回答はありません');
        return;
      }
      try {
        await refresh();
      } catch (caught) {
        console.warn('暗記結果の取り消し後に一覧を更新できませんでした', caught);
      }
      void requestSync(true).catch(() => undefined);
      if (!isCurrentAction()) return;
      navigate({ name: 'study', sessionId: restored.session.id });
    } catch (caught) {
      if (isCurrentAction()) toast(caught instanceof Error ? caught.message : '回答を取り消せませんでした');
    } finally {
      if (undoActionToken.current === actionToken) {
        undoInFlightSessionId.current = undefined;
        if (mounted.current) setUndoing(false);
      }
    }
  };

  if (loadError) {
    return (
      <div className="card memory-error" role="alert" aria-atomic="true" aria-labelledby="memory-result-error-title" aria-describedby="memory-result-error-detail">
        <h2 id="memory-result-error-title">学習結果を開けませんでした</h2>
        <p id="memory-result-error-detail">{loadError}</p>
        <div className="row" role="group" aria-label="読込エラーの操作" style={{ gap: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={() => setReloadKey((value) => value + 1)}>再読み込み</button>
          <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'home' })}>暗記ホームへ戻る</button>
        </div>
      </div>
    );
  }
  if (!session || !bundle) return <div className="card memory-loading" role="status" aria-live="polite" aria-atomic="true" aria-busy="true">学習結果をまとめています…</div>;

  return (
    <section className="memory-result memory-simple-result" aria-labelledby="memory-result-title" aria-describedby="memory-result-summary">
      <div className="memory-result-hero"><span aria-hidden="true">✓</span><h2 id="memory-result-title">学習完了</h2><p id="memory-result-summary">カード {initialTargetCount}件・回答 {attempts.length}回</p></div>
      {(syncingResult || syncWarning) && (
        <p className="faint" role="status" aria-live="polite">
          {syncWarning ?? '最新の暗記データを同期しています…'}
        </p>
      )}
      <div className="memory-simple-result-grid" role="list" aria-label="カード単位の学習結果">
        <div className="card" role="listitem" aria-label={`覚えた ${counts.remembered}件`}><small>覚えた</small><b>{counts.remembered}</b></div>
        <div className="card" role="listitem" aria-label={`あやしい ${counts.unsure}件`}><small>あやしい</small><b>{counts.unsure}</b></div>
        <div className="card" role="listitem" aria-label={`まだ ${counts.missed}件`}><small>まだ</small><b>{counts.missed}</b></div>
        <div className="card" role="listitem" aria-label={`次回も優先 ${needsReview.length}件`}><small>次回も優先</small><b>{needsReview.length}</b></div>
      </div>
      {needsReview.length > 0 && <div className="card memory-needs-review"><h3 id="memory-needs-review-title">次回も優先するカード</h3><div role="list" aria-labelledby="memory-needs-review-title">{needsReview.map(({ targetId, label }) => <span key={targetId} role="listitem">{label}</span>)}</div></div>}
      <div className="memory-result-actions" role="group" aria-label="学習結果の操作">
        <button type="button" className="btn btn-ghost" onClick={() => navigate({ name: 'home' })}><Home size={18} aria-hidden="true" />暗記ホーム</button>
        <button type="button" className="btn btn-ghost" aria-busy={undoing} disabled={undoing || attempts.length === 0} onClick={() => void undoLast()}><RotateCcw size={18} aria-hidden="true" />{undoing ? '取り消し中…' : '最後を取り消す'}</button>
        <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'studySetup', setIds: session.selectedSetIds })}><RotateCw size={18} aria-hidden="true" />もう一度</button>
      </div>
      <span className="sr-only" role="status" aria-live="polite">{undoing ? '最後の回答を取り消しています' : ''}</span>
    </section>
  );
}
