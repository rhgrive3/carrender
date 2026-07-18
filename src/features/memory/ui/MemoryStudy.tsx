import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, RotateCcw, X } from 'lucide-react';
import type { MemorySession, MemorySetBundle } from '../domain/types';
import { currentLearningTarget, sessionQueueProgress } from '../domain/sessionQueue';
import { answerMemoryQuestion, queueFromSession, sessionContentIsRestorable, undoMemoryAnswer } from '../application/session';
import { useToast } from '../../../components/ui/Toast';
import { useMemory } from './MemoryContext';

const SWIPE_THRESHOLD_PX = 48;
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
  const pointerStartX = useRef<number | null>(null);
  const ignoreNextClick = useRef(false);
  const mounted = useRef(true);
  const actionInFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

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
        await refresh();
        throw new Error('旧形式の問題セッションは廃止されました。新しいカード学習を開始してください');
      }
      if (!sessionContentIsRestorable(content, targets, false)) {
        await repository.saveSession({ ...loaded, status: 'abandoned', updatedAt: new Date().toISOString() });
        await refresh();
        throw new Error('学習中のカードが編集または削除されました。新しい学習を開始してください');
      }
      if (!cancelled) {
        setSession(loaded);
        setBundle({ ...content, sets: [], setMembers: [] });
      }
    })().catch((caught) => {
      if (!cancelled) setLoadError(caught instanceof Error ? caught.message : 'セッションを開けませんでした');
    });
    return () => { cancelled = true; };
  }, [navigate, refresh, reloadKey, repository, sessionId]);

  const queue = useMemo(() => session ? queueFromSession(session) : undefined, [session]);
  const target = queue ? currentLearningTarget(queue) : undefined;
  const progress = queue ? sessionQueueProgress(queue) : undefined;
  const item = bundle?.items.find((value) => value.id === target?.itemId);
  const sense = bundle?.senses.find((value) => value.id === target?.senseId);
  const answers = bundle?.answers.filter((answer) => answer.senseId === target?.senseId && answer.verificationStatus === 'verified') ?? [];
  const example = bundle?.examples.find((value) => value.senseId === target?.senseId && value.verificationStatus === 'verified');

  useEffect(() => {
    setRevealed(false);
    setFlipDirection(undefined);
    questionStarted.current = performance.now();
  }, [session?.answerCount, target?.id]);

  const requestSyncSafely = (force: boolean) => {
    void requestSync(force).catch(() => {
      // 回答・取り消しは端末へ保存済み。同期失敗はContextの状態表示と次回同期へ委ねる。
    });
  };

  const beginAction = () => {
    if (actionInFlight.current) return false;
    actionInFlight.current = true;
    setBusy(true);
    return true;
  };

  const finishAction = () => {
    actionInFlight.current = false;
    if (mounted.current) setBusy(false);
  };

  const commit = async (assessment: 'correct' | 'partial' | 'incorrect') => {
    if (!repository || !session || !target || !beginAction()) return;
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
      await refresh();
      requestSyncSafely(result.session.status === 'completed');
      // 保存中に利用者が暗記ホームへ戻った場合、完了後に古い学習画面へ
      // 勝手に遷移させない。IndexedDBへの回答保存と同期要求はそのまま維持する。
      if (!mounted.current) return;
      setRevealed(false);
      setFlipDirection(undefined);
      questionStarted.current = performance.now();
      setSession(result.session);
      if (result.session.status === 'completed') navigate({ name: 'result', sessionId: result.session.id });
    } catch (caught) {
      if (mounted.current) toast(caught instanceof Error ? caught.message : '回答を保存できませんでした');
    } finally {
      finishAction();
    }
  };

  const undo = async () => {
    if (!repository || !session || !beginAction()) return;
    try {
      const restored = await undoMemoryAnswer(repository, session);
      if (!restored) {
        if (mounted.current) toast('取り消せる回答はありません');
        return;
      }
      // 取り消し自体は既にIndexedDBへ保存済み。画面を閉じた直後でも、
      // Contextの集計更新と端末間同期は最後まで要求する。
      await refresh();
      requestSyncSafely(false);
      if (!mounted.current) return;
      setRevealed(false);
      setFlipDirection(undefined);
      setSession(restored.session);
      toast('最後の回答を取り消しました');
    } catch (caught) {
      if (mounted.current) toast(caught instanceof Error ? caught.message : '回答の取り消しを保存できませんでした');
    } finally {
      finishAction();
    }
  };

  const setCardSide = (next: boolean) => {
    if (busy || next === revealed) return;
    setFlipDirection(next ? 'to-answer' : 'to-question');
    setRevealed(next);
  };

  const handleFaceClick = (next: boolean) => {
    if (ignoreNextClick.current) {
      ignoreNextClick.current = false;
      return;
    }
    setCardSide(next);
  };

  const handlePointerUp = (clientX: number) => {
    const start = pointerStartX.current;
    pointerStartX.current = null;
    if (start === null || busy) return;
    const delta = clientX - start;
    if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
    ignoreNextClick.current = true;
    setCardSide(delta < 0);
    window.setTimeout(() => { ignoreNextClick.current = false; }, 0);
  };

  if (loadError) {
    return (
      <div className="memory-study-overlay">
        <div className="card memory-study-load-error" role="alert">
          <h2>セッションを開けませんでした</h2>
          <p>{loadError}</p>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setReloadKey((value) => value + 1)}>再読み込み</button>
            <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'home' })}>暗記ホームへ戻る</button>
          </div>
        </div>
      </div>
    );
  }
  if (!session || !bundle || !queue || !target || !sense || !item || !progress) {
    return <div className="memory-study-overlay"><div className="memory-study-loading" role="status" aria-live="polite">カードを準備しています…</div></div>;
  }

  const prompt = target.mode === 'input' ? item.label : sense.promptJa;
  const displayedAnswers = target.mode === 'input'
    ? uniqueDisplayAnswers([sense.promptJa])
    : uniqueDisplayAnswers(answers.map((value) => value.displayForm));
  const directionLabel = target.mode === 'output' ? '日本語 → 英語' : '英語 → 日本語';
  const promptLanguage = target.mode === 'output' ? '日本語' : '英語';
  const answerLanguage = target.mode === 'output' ? '英語' : '日本語';

  return (
    <div className="memory-study-overlay memory-simple-study" role="dialog" aria-modal="true" aria-label="暗記学習">
      <header className="memory-study-header">
        <button type="button" className="memory-study-icon" aria-label="学習を閉じて途中保存" onClick={() => navigate({ name: 'home' })}><X size={23} /></button>
        <div className="memory-study-progress" aria-live="polite"><b>{progress.graduated} / {progress.total}</b><span>回答 {progress.answerCount}回</span></div>
        <button type="button" className="memory-study-icon" aria-label="最後の回答を取り消す" disabled={!queue.undo || busy} onClick={() => void undo()}><RotateCcw size={21} /></button>
      </header>
      <div className="memory-study-mode">{directionLabel}</div>
      <div className="memory-study-stage">
        <div
          className="memory-study-flip-shell"
          onClick={() => handleFaceClick(!revealed)}
          onPointerDown={(event) => { if (event.isPrimary) pointerStartX.current = event.clientX; }}
          onPointerUp={(event) => { if (event.isPrimary) handlePointerUp(event.clientX); }}
          onPointerCancel={() => { pointerStartX.current = null; }}
        >
          <article
            key={target.id}
            className={`memory-study-card memory-simple-study-card ${revealed ? 'revealed' : ''} ${flipDirection ? `flip-${flipDirection}` : ''}`}
            data-card-side={revealed ? 'answer' : 'question'}
          >
            <div
              className="memory-study-card-inner"
              onAnimationEnd={(event) => {
                if (event.animationName.startsWith('memory-card-android-flip-')) setFlipDirection(undefined);
              }}
            >
              <button
                type="button"
                className="memory-study-card-face memory-study-card-front"
                aria-label="答えを見る"
                aria-hidden={revealed}
                tabIndex={revealed ? -1 : 0}
                disabled={busy}
              >
                <span className="memory-card-side-label">問題 <small>{promptLanguage}</small></span>
                <h1>{prompt}</h1>
                <span className="memory-card-toggle-hint"><Eye size={18} />タップして答えを見る</span>
                <span className="memory-card-swipe-hint">左へスワイプでもめくれます</span>
              </button>

              <button
                type="button"
                className="memory-study-card-face memory-study-card-back"
                aria-label="問題に戻る"
                aria-hidden={!revealed}
                tabIndex={revealed ? 0 : -1}
                disabled={busy}
              >
                <span className="memory-card-side-label">答え <small>{answerLanguage}</small></span>
                <div className="memory-card-back-prompt">{prompt}</div>
                <div className="memory-answer-reveal">
                  <div className="memory-card-answer-list">
                    {(displayedAnswers.length > 0 ? displayedAnswers : ['答えが登録されていません']).map((value, index) => <h2 key={`${value}-${index}`}>{value}</h2>)}
                  </div>
                  {example && <div className="memory-example"><span>{example.english}</span>{example.japanese && <small>{example.japanese}</small>}</div>}
                </div>
                <span className="memory-card-toggle-hint"><EyeOff size={18} />タップして問題に戻る</span>
                <span className="memory-card-swipe-hint">右へスワイプでも戻せます</span>
              </button>
            </div>
          </article>
        </div>

        {revealed && (
          <div className="memory-simple-assessment" aria-label="自己評価">
            <button type="button" className="memory-again" aria-label="まだ" disabled={busy} onClick={() => void commit('incorrect')}><span>まだ</span><small>もう一度</small></button>
            <button type="button" className="memory-partial" aria-label="あやしい" disabled={busy} onClick={() => void commit('partial')}><span>あやしい</span><small>あとで確認</small></button>
            <button type="button" className="memory-good" aria-label="覚えた" disabled={busy} onClick={() => void commit('correct')}><span>覚えた</span><small>次へ</small></button>
          </div>
        )}
      </div>
    </div>
  );
}
