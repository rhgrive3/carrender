import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Eye, RotateCcw, X } from 'lucide-react';
import type { MemorySession, MemorySetBundle } from '../domain/types';
import { currentLearningTarget, sessionQueueProgress } from '../domain/sessionQueue';
import { answerMemoryQuestion, queueFromSession, sessionContentIsRestorable, undoMemoryAnswer } from '../application/session';
import { useToast } from '../../../components/ui/Toast';
import { useMemory } from './MemoryContext';

export function MemoryStudy({ sessionId }: { sessionId: string }) {
  const { repository, navigate, refresh, requestSync } = useMemory();
  const toast = useToast();
  const [session, setSession] = useState<MemorySession>();
  const [bundle, setBundle] = useState<MemorySetBundle>();
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const questionStarted = useRef(performance.now());

  useEffect(() => {
    if (!repository) return;
    let cancelled = false;
    void (async () => {
      const loaded = await repository.getSession(sessionId);
      if (!loaded) throw new Error('学習セッションが見つかりません');
      if (loaded.status === 'abandoned') throw new Error('この学習セッションは終了済みです');
      if (loaded.status === 'completed') {
        navigate({ name: 'result', sessionId: loaded.id });
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
  }, [navigate, refresh, repository, sessionId]);

  const queue = useMemo(() => session ? queueFromSession(session) : undefined, [session]);
  const target = queue ? currentLearningTarget(queue) : undefined;
  const progress = queue ? sessionQueueProgress(queue) : undefined;
  const item = bundle?.items.find((value) => value.id === target?.itemId);
  const sense = bundle?.senses.find((value) => value.id === target?.senseId);
  const answers = bundle?.answers.filter((answer) => answer.senseId === target?.senseId && answer.verificationStatus === 'verified') ?? [];
  const example = bundle?.examples.find((value) => value.senseId === target?.senseId && value.verificationStatus === 'verified');

  useEffect(() => {
    setRevealed(false);
    questionStarted.current = performance.now();
  }, [target?.id]);

  const commit = async (assessment: 'correct' | 'partial' | 'incorrect') => {
    if (!repository || !session || !target || busy) return;
    setBusy(true);
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
      setSession(result.session);
      await refresh();
      void requestSync(result.session.status === 'completed');
      if (result.session.status === 'completed') navigate({ name: 'result', sessionId: result.session.id });
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '回答を保存できませんでした');
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!repository || !session || busy) return;
    setBusy(true);
    try {
      const restored = await undoMemoryAnswer(repository, session);
      if (!restored) toast('取り消せる回答はありません');
      else {
        setSession(restored.session);
        await refresh();
        toast('最後の回答を取り消しました');
      }
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return <div className="memory-study-overlay"><div className="card memory-study-load-error" role="alert"><h2>セッションを開けませんでした</h2><p>{loadError}</p><button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'home' })}>暗記ホームへ戻る</button></div></div>;
  }
  if (!session || !bundle || !queue || !target || !sense || !item || !progress) {
    return <div className="memory-study-overlay"><div className="memory-study-loading">カードを準備しています…</div></div>;
  }

  const prompt = target.mode === 'input' ? item.label : sense.promptJa;
  const answer = target.mode === 'input' ? sense.promptJa : answers.map((value) => value.displayForm).join('／');

  return (
    <div className="memory-study-overlay memory-simple-study" role="dialog" aria-modal="true" aria-label="暗記学習">
      <header className="memory-study-header">
        <button type="button" className="memory-study-icon" aria-label="学習を閉じて途中保存" onClick={() => navigate({ name: 'home' })}><X size={23} /></button>
        <div className="memory-study-progress"><b>{progress.graduated} / {progress.total}</b><span>回答 {progress.answerCount}回</span></div>
        <button type="button" className="memory-study-icon" aria-label="最後の回答を取り消す" disabled={!queue.undo || busy} onClick={() => void undo()}><RotateCcw size={21} /></button>
      </header>
      <div className="memory-study-mode">{target.mode === 'output' ? '日本語 → 英語' : '英語 → 日本語'}</div>
      <main className="memory-study-stage">
        <article className={`memory-study-card memory-simple-study-card ${revealed ? 'revealed' : ''}`} aria-live="polite" onClick={() => { if (!revealed) setRevealed(true); }}>
          <span className="memory-simple-card-kicker">{revealed ? '答え' : '思い出す'}</span>
          <h1>{prompt}</h1>
          {!revealed ? (
            <button type="button" className="memory-reveal-button" onClick={(event) => { event.stopPropagation(); setRevealed(true); }}><Eye size={20} />答えを見る</button>
          ) : (
            <div className="memory-answer-reveal">
              <h2>{answer || '答えが登録されていません'}</h2>
              {example && <div className="memory-example"><span>{example.english}</span>{example.japanese && <small>{example.japanese}</small>}</div>}
            </div>
          )}
        </article>
        {revealed && (
          <div className="memory-simple-assessment" aria-label="自己評価">
            <button type="button" className="memory-again" disabled={busy} onClick={() => void commit('incorrect')}><ChevronLeft size={20} />まだ</button>
            <button type="button" className="memory-partial" disabled={busy} onClick={() => void commit('partial')}>あやしい</button>
            <button type="button" className="memory-good" disabled={busy} onClick={() => void commit('correct')}>覚えた</button>
          </div>
        )}
      </main>
    </div>
  );
}
