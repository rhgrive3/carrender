import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff, RotateCcw, X } from 'lucide-react';
import type { MemorySession, MemorySetBundle } from '../domain/types';
import { englishFormsForSense, examplesForSense, primaryEnglishForSense } from '../domain/cardIntegrity';
import { currentLearningTarget, sessionQueueProgress } from '../domain/sessionQueue';
import { answerMemoryQuestion, queueFromSession, sessionContentIsRestorable, undoMemoryAnswer } from '../application/session';
import { useToast } from '../../../components/ui/Toast';
import { acquireModalIsolation, trapModalTabKey } from '../../../components/ui/Sheet';
import { useMemory } from './MemoryContext';
import { memorySwipeDirection, type MemorySwipeStart } from './memorySwipeGesture';

type CardFlipDirection = 'to-answer' | 'to-question';

export function uniqueDisplayAnswers(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const answers: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    answers.push(normalized);
  }
  return answers;
}

export function MemoryStudy({ sessionId }: { sessionId: string }) {
  const { repository, navigate, refresh, requestSync } = useMemory();
  const toast = useToast();
  const [session, setSession] = useState<MemorySession>();
  const [bundle, setBundle] = useState<MemorySetBundle>();
  const [revealed, setRevealed] = useState(false);
  const [flipDirection, setFlipDirection] = useState<CardFlipDirection>();
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);
  const questionStarted = useRef(performance.now());
  const pointerStart = useRef<MemorySwipeStart | null>(null);
  const ignoreNextClick = useRef(false);
  const mounted = useRef(true);
  const activeSessionId = useRef(sessionId);
  const actionInFlight = useRef(false);
  const actionToken = useRef(0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  activeSessionId.current = sessionId;
  busyRef.current = busy;

  const requestSyncSafely = (force: boolean) => { void requestSync(force).catch(() => undefined); };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useLayoutEffect(() => {
    actionToken.current += 1;
    actionInFlight.current = false;
    pointerStart.current = null;
    ignoreNextClick.current = false;
    setSession(undefined);
    setBundle(undefined);
    setLoadError(undefined);
    setRevealed(false);
    setFlipDirection(undefined);
    setBusy(false);
  }, [repository, sessionId]);

  useEffect(() => {
    const root = overlayRef.current;
    if (!root) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restoreIsolation = acquireModalIsolation(root);
    const frame = window.requestAnimationFrame(() => {
      (root.querySelector<HTMLElement>('.memory-study-icon, button, [role="button"]') ?? root).focus({ preventScroll: true });
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (root.hasAttribute('inert')) return;
      if (event.key === 'Escape') {
        if (event.isComposing || event.keyCode === 229 || busyRef.current) return;
        event.preventDefault();
        navigate({ name: 'home' });
        return;
      }
      trapModalTabKey(event, root);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      restoreIsolation();
      if (previous?.isConnected && !previous.closest('[inert], [hidden], [aria-hidden="true"]')) previous.focus({ preventScroll: true });
    };
  }, [navigate, sessionId]);

  useEffect(() => {
    if (!repository) return;
    let cancelled = false;
    setSession(undefined);
    setBundle(undefined);
    setLoadError(undefined);
    void (async () => {
      const loaded = await repository.getSession(sessionId);
      if (!loaded) throw new Error('学習セッションが見つかりません');
      if (loaded.status === 'abandoned') throw new Error('この学習セッションは終了済みです');
      if (loaded.status === 'completed') {
        if (!cancelled) navigate({ name: 'result', sessionId: loaded.id });
        return;
      }
      const content = await repository.loadContent();
      const restoredQueue = queueFromSession(loaded);
      const targets = Object.values(restoredQueue.targetsById);
      if (targets.some((target) => target.exerciseId || (target.mode !== 'input' && target.mode !== 'output'))) {
        await repository.saveSession({ ...loaded, status: 'abandoned', updatedAt: new Date().toISOString() });
        try { await refresh(); } catch (caught) { console.warn('旧形式の暗記セッション終了後に一覧を更新できませんでした', caught); }
        requestSyncSafely(false);
        throw new Error('旧形式の問題セッションは廃止されました。新しいカード学習を開始してください');
      }
      if (!sessionContentIsRestorable(content, targets, false)) {
        await repository.saveSession({ ...loaded, status: 'abandoned', updatedAt: new Date().toISOString() });
        try { await refresh(); } catch (caught) { console.warn('復元不能な暗記セッション終了後に一覧を更新できませんでした', caught); }
        requestSyncSafely(false);
        throw new Error('学習中のカードが編集または削除されました。英語と日本語の対応が壊れている場合もあります。新しい学習を開始してください');
      }
      if (!cancelled) {
        setSession(loaded);
        setBundle({ ...content, sets: [], setMembers: [] });
      }
    })().catch((caught) => {
      if (!cancelled) setLoadError(caught instanceof Error ? caught.message : 'セッションを開けませんでした');
    });
    return () => { cancelled = true; };
  }, [navigate, refresh, reloadKey, repository, requestSync, sessionId]);

  const queue = useMemo(() => session ? queueFromSession(session) : undefined, [session]);
  const target = queue ? currentLearningTarget(queue) : undefined;
  const progress = queue ? sessionQueueProgress(queue) : undefined;
  const item = bundle?.items.find((value) => value.id === target?.itemId);
  const sense = bundle?.senses.find((value) => value.id === target?.senseId);

  useEffect(() => {
    pointerStart.current = null;
    ignoreNextClick.current = false;
    setRevealed(false);
    setFlipDirection(undefined);
    questionStarted.current = performance.now();
  }, [session?.answerCount, target?.id]);

  const refreshAfterPersist = async (operation: '回答保存' | '回答取り消し') => {
    try { await refresh(); } catch (caught) { console.warn(`暗記学習の${operation}後に一覧を更新できませんでした`, caught); }
  };

  const beginAction = () => {
    if (actionInFlight.current) return undefined;
    pointerStart.current = null;
    ignoreNextClick.current = false;
    const token = actionToken.current + 1;
    actionToken.current = token;
    actionInFlight.current = true;
    setBusy(true);
    return token;
  };

  const finishAction = (token: number) => {
    if (actionToken.current !== token) return;
    actionInFlight.current = false;
    if (mounted.current) setBusy(false);
  };

  const commit = async (assessment: 'correct' | 'partial' | 'incorrect') => {
    if (!repository || !session || !target) return;
    const token = beginAction();
    if (token === undefined) return;
    const actionSessionId = session.id;
    try {
      const result = await answerMemoryQuestion({
        repository,
        session,
        assessment,
        clientId: await repository.clientId(),
        errorTypes: assessment === 'correct' ? [] : ['recall'],
        hintUsed: false,
        responseMs: performance.now() - questionStarted.current,
        presentedExerciseType: 'flashcard',
      });
      await refreshAfterPersist('回答保存');
      requestSyncSafely(result.session.status === 'completed');
      if (!mounted.current || activeSessionId.current !== actionSessionId || actionToken.current !== token) return;
      setRevealed(false);
      setFlipDirection(undefined);
      questionStarted.current = performance.now();
      setSession(result.session);
      if (result.session.status === 'completed') navigate({ name: 'result', sessionId: result.session.id });
    } catch (caught) {
      if (mounted.current && activeSessionId.current === actionSessionId && actionToken.current === token) toast(caught instanceof Error ? caught.message : '回答を保存できませんでした');
    } finally {
      finishAction(token);
    }
  };

  const undo = async () => {
    if (!repository || !session) return;
    const token = beginAction();
    if (token === undefined) return;
    const actionSessionId = session.id;
    try {
      const restored = await undoMemoryAnswer(repository, session);
      if (!restored) {
        if (mounted.current && activeSessionId.current === actionSessionId && actionToken.current === token) toast('取り消せる回答はありません');
        return;
      }
      await refreshAfterPersist('回答取り消し');
      requestSyncSafely(false);
      if (!mounted.current || activeSessionId.current !== actionSessionId || actionToken.current !== token) return;
      setRevealed(false);
      setFlipDirection(undefined);
      setSession(restored.session);
      toast('最後の回答を取り消しました');
    } catch (caught) {
      if (mounted.current && activeSessionId.current === actionSessionId && actionToken.current === token) toast(caught instanceof Error ? caught.message : '回答の取り消しを保存できませんでした');
    } finally {
      finishAction(token);
    }
  };

  const setCardSide = (next: boolean) => {
    if (busy || next === revealed) return;
    setFlipDirection(next ? 'to-answer' : 'to-question');
    setRevealed(next);
  };
  const handleFaceClick = (next: boolean) => {
    if (ignoreNextClick.current) { ignoreNextClick.current = false; return; }
    setCardSide(next);
  };
  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (busy) return;
    const direction = memorySwipeDirection(start, {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      isPrimary: event.isPrimary,
    });
    if (!direction) return;
    ignoreNextClick.current = true;
    setCardSide(direction === 'left');
    window.setTimeout(() => { ignoreNextClick.current = false; }, 0);
  };
  const activateFace = (event: React.KeyboardEvent, next: boolean) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setCardSide(next);
  };

  if (loadError) {
    return createPortal(
      <div ref={overlayRef} className="memory-study-overlay" role="dialog" aria-modal="true" aria-label="暗記学習の読込エラー" tabIndex={-1}>
        <div className="card memory-study-load-error" role="alert"><h2>セッションを開けませんでした</h2><p>{loadError}</p><div className="row" style={{ gap: 8 }}><button type="button" className="btn btn-secondary" onClick={() => setReloadKey((value) => value + 1)}>再読み込み</button><button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'home' })}>暗記ホームへ戻る</button></div></div>
      </div>, document.body,
    );
  }
  if (!session || !bundle || !queue || !target || !sense || !item || !progress) {
    return createPortal(<div ref={overlayRef} className="memory-study-overlay" role="dialog" aria-modal="true" aria-label="暗記学習を準備中" tabIndex={-1}><div className="memory-study-loading" role="status" aria-live="polite">カードを準備しています…</div></div>, document.body);
  }

  const englishAnswers = englishFormsForSense(bundle, sense.id, { verifiedOnly: true });
  const primaryEnglish = primaryEnglishForSense(bundle, sense.id, { verifiedOnly: true });
  const japaneseAnswers = uniqueDisplayAnswers([sense.promptJa, sense.meaningJa]);
  const prompt = target.mode === 'input' ? primaryEnglish ?? '英語表現が未設定です' : sense.promptJa;
  const displayedAnswers = target.mode === 'input' ? japaneseAnswers : englishAnswers;
  const directionLabel = target.mode === 'output' ? '日本語 → 英語' : '英語 → 日本語';
  const promptLanguage = target.mode === 'output' ? '日本語' : '英語';
  const answerLanguage = target.mode === 'output' ? '英語' : '日本語';
  const examples = examplesForSense(bundle, sense.id, { verifiedOnly: true });
  const questionExample = target.mode === 'input' ? examples[0]?.english : examples[0]?.japanese;

  return createPortal(
    <div ref={overlayRef} className="memory-study-overlay memory-simple-study" role="dialog" aria-modal="true" aria-label="暗記学習" tabIndex={-1}>
      <header className="memory-study-header">
        <button type="button" className="memory-study-icon" aria-label="学習を閉じて途中保存" disabled={busy} onClick={() => navigate({ name: 'home' })}><X size={23} aria-hidden="true" /></button>
        <div className="memory-study-progress" aria-live="polite"><b>{progress.graduated} / {progress.total}</b><span>回答 {progress.answerCount}回</span></div>
        <button type="button" className="memory-study-icon" aria-label="最後の回答を取り消す" disabled={!queue.undo || busy} onClick={() => void undo()}><RotateCcw size={21} aria-hidden="true" /></button>
      </header>
      <div className="memory-study-mode">{directionLabel}</div>
      <div className="memory-study-stage">
        <div
          className="memory-study-flip-shell"
          onPointerDown={(event) => {
            pointerStart.current = event.isPrimary
              ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
              : null;
          }}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => { pointerStart.current = null; ignoreNextClick.current = false; }}
        >
          <article key={target.id} className={`memory-study-card memory-simple-study-card ${revealed ? 'revealed' : ''} ${flipDirection ? `flip-${flipDirection}` : ''}`} data-card-side={revealed ? 'answer' : 'question'}>
            <div className="memory-study-card-inner" onAnimationEnd={(event) => { if (event.animationName.startsWith('memory-card-android-flip-')) setFlipDirection(undefined); }}>
              <div role="button" className="memory-study-card-face memory-study-card-front" aria-label="答えを見る" aria-hidden={revealed} aria-disabled={busy} tabIndex={revealed || busy ? -1 : 0} onClick={() => handleFaceClick(true)} onKeyDown={(event) => activateFace(event, true)}>
                <span className="memory-card-side-label">問題 <small>{promptLanguage}</small></span><h1>{prompt}</h1>{questionExample && <div className="memory-question-example">{questionExample}</div>}<span className="memory-card-toggle-hint"><Eye size={18} aria-hidden="true" />タップして答えを見る</span><span className="memory-card-swipe-hint">左へスワイプでもめくれます</span>
              </div>
              <div role="button" className="memory-study-card-face memory-study-card-back" aria-label="問題に戻る" aria-hidden={!revealed} aria-disabled={busy} tabIndex={revealed && !busy ? 0 : -1} onClick={() => handleFaceClick(false)} onKeyDown={(event) => activateFace(event, false)}>
                <span className="memory-card-side-label">答え <small>{answerLanguage}</small></span><div className="memory-card-back-prompt">{prompt}</div><div className="memory-answer-reveal"><div className="memory-card-answer-list">{(displayedAnswers.length > 0 ? displayedAnswers : ['答えが登録されていません']).map((value, index) => <h2 key={`${value}-${index}`}>{value}</h2>)}</div>{examples.length > 0 && <div className="memory-example-list" aria-label="例文">{examples.map((example) => <div className="memory-example" key={example.id}><span>{example.english}</span>{example.japanese && <small>{example.japanese}</small>}</div>)}</div>}</div><span className="memory-card-toggle-hint"><EyeOff size={18} aria-hidden="true" />タップして問題に戻る</span><span className="memory-card-swipe-hint">右へスワイプでも戻せます</span>
              </div>
            </div>
          </article>
        </div>
        {revealed && <div className="memory-simple-assessment" aria-label="自己評価"><button type="button" className="memory-again" aria-label="まだ" disabled={busy} onClick={() => void commit('incorrect')}><span>まだ</span><small>もう一度</small></button><button type="button" className="memory-partial" aria-label="あやしい" disabled={busy} onClick={() => void commit('partial')}><span>あやしい</span><small>あとで確認</small></button><button type="button" className="memory-good" aria-label="覚えた" disabled={busy} onClick={() => void commit('correct')}><span>覚えた</span><small>次へ</small></button></div>}
      </div>
    </div>,
    document.body,
  );
}
