import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChevronLeft, Eye, Lightbulb, RotateCcw, X } from 'lucide-react';
import type { ErrorType, MemoryAnswer, MemorySession, MemorySetBundle } from '../domain/types';
import { gradeAnswer, gradeInputMeaning, inspectCompositionAnswer, type GradeResult } from '../domain/grading';
import { normalizeAnswerText } from '../domain/normalization';
import { currentLearningTarget, sessionQueueProgress } from '../domain/sessionQueue';
import { buildAnswerChoiceDistractors, buildInputMeaningChoices } from '../domain/studyChoices';
import { addAnswerToSense } from '../application/content';
import { answerMemoryQuestion, queueFromSession, sessionContentIsRestorable, undoMemoryAnswer } from '../application/session';
import { useToast } from '../../../components/ui/Toast';
import { useMemory } from './MemoryContext';

const ERROR_LABELS: Array<[ErrorType, string]> = [
  ['meaning', '意味が出なかった'], ['recall', '思い出せなかった'], ['spelling', 'スペル'], ['word_form', '語形'],
  ['article', '冠詞'], ['preposition', '前置詞'], ['word_order', '語順'], ['tense', '時制'],
  ['agreement', '主語と動詞の一致'], ['register', '文体・語調'], ['context', '文脈不適合'], ['other', 'その他'],
];

function answerCandidates(
  target: ReturnType<typeof currentLearningTarget>,
  bundle: MemorySetBundle,
  includeUnverifiedAi: boolean,
): MemoryAnswer[] {
  if (!target) return [];
  const all = bundle.answers.filter((answer) => answer.senseId === target.senseId
    && (includeUnverifiedAi || answer.verificationStatus === 'verified'));
  const exercise = bundle.exercises.find((value) => value.id === target.exerciseId);
  if (exercise?.acceptedAnswerIds.length) return exercise.acceptedAnswerIds.flatMap((id) => all.filter((answer) => answer.id === id));
  if (target.answerId) return all.filter((answer) => answer.id === target.answerId);
  return all;
}

function inferredErrors(result: GradeResult, mode: string, userAnswer: string, answers: MemoryAnswer[]): ErrorType[] {
  if (result.assessment === 'correct') return [];
  if (mode === 'context' && result.errorTypes.includes('spelling')) {
    const normalized = normalizeAnswerText(userAnswer).replace(/(?:ed|ing|s)$/u, '');
    if (answers.some((answer) => normalizeAnswerText(answer.displayForm).replace(/(?:ed|ing|s)$/u, '') === normalized)) return ['word_form'];
  }
  return result.errorTypes;
}

function modeLabel(mode: string): string {
  return mode === 'input' ? '英→日' : mode === 'output' ? '日→英' : mode === 'context' ? '文中で使う' : '英作文';
}

export function MemoryStudy({ sessionId }: { sessionId: string }) {
  const { repository, navigate, refresh, requestSync } = useMemory();
  const toast = useToast();
  const [session, setSession] = useState<MemorySession>();
  const [bundle, setBundle] = useState<MemorySetBundle>();
  const [revealed, setRevealed] = useState(false);
  const [typedAnswer, setTypedAnswer] = useState('');
  const [grade, setGrade] = useState<GradeResult>();
  const [selectedAnswerId, setSelectedAnswerId] = useState<string>();
  const [selectedInputSenseId, setSelectedInputSenseId] = useState<string>();
  const [errorTypes, setErrorTypes] = useState<ErrorType[]>([]);
  const [hintUsed, setHintUsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pointerStart, setPointerStart] = useState<number>();
  const [loadError, setLoadError] = useState<string>();
  const questionStarted = useRef(performance.now());
  const answerInput = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!repository) return;
    let cancelled = false;
    setLoadError(undefined);
    void (async () => {
      const loaded = await repository.getSession(sessionId);
      if (!loaded) throw new Error('学習セッションが見つかりません');
      if (loaded.status === 'abandoned') throw new Error('この学習セッションは終了済みです');
      if (loaded.status === 'completed') {
        if (!cancelled) navigate({ name: 'result', sessionId: loaded.id });
        return;
      }
      // Membership can change after a session starts. Resolve target content
      // from the whole active knowledge base, not only current set membership.
      const content = await repository.loadContent();
      const restoredQueue = queueFromSession(loaded);
      const targets = Object.values(restoredQueue.targetsById);
      if (!sessionContentIsRestorable(content, targets, loaded.config.includeUnverifiedAi)) {
        const abandoned: MemorySession = {
          ...loaded,
          status: 'abandoned',
          updatedAt: new Date().toISOString(),
          completedAt: undefined,
        };
        await repository.saveSession(abandoned);
        await refresh();
        throw new Error('学習中の項目が編集または削除されたため、このセッションを終了しました。新しいセッションを開始してください');
      }
      const bundle: MemorySetBundle = { ...content, sets: [], setMembers: [] };
      if (!cancelled) { setSession(loaded); setBundle(bundle); questionStarted.current = performance.now(); }
    })().catch((caught) => {
      const message = caught instanceof Error ? caught.message : 'セッションを開けませんでした';
      setLoadError(message);
      toast(message);
    });
    return () => { cancelled = true; };
  }, [navigate, refresh, repository, sessionId, toast]);

  const queue = useMemo(() => session ? queueFromSession(session) : undefined, [session]);
  const target = queue ? currentLearningTarget(queue) : undefined;
  const progress = queue ? sessionQueueProgress(queue) : undefined;
  const item = bundle?.items.find((value) => value.id === target?.itemId);
  const sense = bundle?.senses.find((value) => value.id === target?.senseId);
  const exercise = bundle?.exercises.find((value) => value.id === target?.exerciseId);
  const answers = useMemo(
    () => target && bundle ? answerCandidates(target, bundle, session?.config.includeUnverifiedAi ?? false) : [],
    [bundle, session?.config.includeUnverifiedAi, target],
  );
  const examples = bundle?.examples.filter((example) => example.senseId === target?.senseId
    && (session?.config.includeUnverifiedAi || example.verificationStatus === 'verified')) ?? [];
  const allItemSenses = bundle?.senses.filter((value) => value.itemId === item?.id
    && (session?.config.includeUnverifiedAi
      || (item?.verificationStatus === 'verified' && value.verificationStatus === 'verified'))) ?? [];
  const isComposition = target?.mode === 'composition' || exercise?.type === 'guided_composition' || exercise?.type === 'free_composition';
  const inputMeaningChoices = useMemo(() => target && bundle && session
    ? buildInputMeaningChoices({
        content: bundle,
        target,
        seed: session.seed,
        includeUnverifiedAi: session.config.includeUnverifiedAi,
      })
    : [], [bundle, session, target]);
  const inputUsesChoice = target?.mode === 'input'
    && session?.config.preferredExerciseType === 'multiple_choice'
    && inputMeaningChoices.length > 1;
  const usesTypedAnswer = !inputUsesChoice
    && (target?.exerciseType !== 'flashcard' || session?.config.preferredExerciseType === 'typed_output');

  useEffect(() => {
    setRevealed(false); setTypedAnswer(''); setGrade(undefined); setSelectedAnswerId(undefined); setSelectedInputSenseId(undefined);
    setErrorTypes([]); setHintUsed(false); questionStarted.current = performance.now();
    if (usesTypedAnswer) window.requestAnimationFrame(() => answerInput.current?.focus());
  }, [target?.id, usesTypedAnswer]);

  const prompt = (() => {
    if (!target || !sense || !item) return '';
    if (exercise) return exercise.prompt;
    if (target.mode === 'input') {
      const contextExample = examples[0];
      if (allItemSenses.length > 1 && contextExample) return `${item.label}\n${contextExample.english}`;
      if (allItemSenses.length > 1) return `${item.label}\n主な意味を確認してください`;
      return item.label;
    }
    return sense.promptJa;
  })();

  const reveal = () => {
    if (!target) return;
    setRevealed(true);
  };

  const submitTyped = () => {
    if (!target || !sense || !bundle || !typedAnswer.trim()) return;
    if (isComposition) {
      setRevealed(true);
      return;
    }
    const rawResult = target.mode === 'input'
      ? gradeInputMeaning({ userAnswer: typedAnswer, eligibleMeanings: [sense.promptJa, sense.meaningJa] })
      : gradeAnswer({
        userAnswer: typedAnswer,
        eligibleAnswers: answers,
        allKnownAnswers: bundle.answers.filter((answer) => session?.config.includeUnverifiedAi
          || answer.verificationStatus === 'verified'),
        exercise,
      });
    // A visible registered Sense choice is definitively wrong in this exact
    // context, so it must not enter the free-text "natural paraphrase" flow.
    const result = inputUsesChoice && selectedInputSenseId !== sense.id
      ? { ...rawResult, assessment: 'incorrect' as const, needsUserConfirmation: false, errorTypes: ['meaning' as const] }
      : rawResult;
    setGrade(result);
    setSelectedAnswerId(result.matchedAnswerId);
    setErrorTypes(inferredErrors(result, target.mode, typedAnswer, answers));
    setRevealed(true);
  };

  const commit = async (assessment: 'correct' | 'partial' | 'incorrect' | 'skipped', answerId = selectedAnswerId) => {
    if (!repository || !session || !target || busy) return;
    setBusy(true);
    try {
      const result = await answerMemoryQuestion({
        repository,
        session,
        assessment,
        clientId: await repository.clientId(),
        // Understanding an English prompt does not demonstrate recall of an
        // arbitrary first Answer expression. Input updates Sense stats only.
        answerId: target.mode === 'input' ? target.answerId : answerId,
        userAnswer: typedAnswer || undefined,
        normalizedAnswer: typedAnswer ? normalizeAnswerText(typedAnswer) : undefined,
        errorTypes: assessment === 'correct' ? [] : errorTypes.length > 0 ? errorTypes : ['recall'],
        hintUsed,
        responseMs: performance.now() - questionStarted.current,
        presentedExerciseType: inputUsesChoice
          ? 'multiple_choice'
          : target.exerciseType === 'flashcard' && usesTypedAnswer ? 'typed_output' : undefined,
      });
      setSession(result.session);
      await refresh();
      // Twenty attempts are batched during a session, while completion flushes
      // even a short session as required by the local-first sync contract.
      void requestSync(result.session.status === 'completed');
      if (result.session.status === 'completed') navigate({ name: 'result', sessionId: result.session.id });
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '回答を保存できませんでした');
    } finally {
      setBusy(false);
    }
  };

  const resolveUnknown = async (resolution: 'once' | 'add' | 'incorrect') => {
    if (!repository || !sense) return;
    if (resolution === 'incorrect') {
      await commit('incorrect');
      return;
    }
    let answerId: string | undefined;
    if (resolution === 'add') {
      const added = await addAnswerToSense(repository, sense.id, typedAnswer);
      answerId = added.id;
      setBundle((current) => current ? { ...current, answers: [...current.answers, added] } : current);
      toast('正解表現として追加しました');
    }
    await commit('correct', answerId);
  };

  const undo = async () => {
    if (!repository || !session || busy) return;
    setBusy(true);
    try {
      const restored = await undoMemoryAnswer(repository, session);
      if (!restored) toast('取り消せる回答はありません');
      else { setSession(restored.session); await refresh(); toast('最後の回答を取り消しました'); }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const eventTarget = event.target instanceof HTMLElement ? event.target : null;
      if (eventTarget?.isContentEditable || eventTarget?.closest('input, textarea, button, select, a, [role="button"]')) return;
      if (event.key === ' ' && !revealed) { event.preventDefault(); reveal(); }
      if (event.key === 'ArrowLeft' && revealed && !grade) void commit('incorrect');
      if (event.key === 'ArrowRight' && revealed && !grade && (target?.mode !== 'output' || answers.length <= 1 || selectedAnswerId)) {
        void commit('correct', selectedAnswerId ?? (target?.mode === 'output' ? answers[0]?.id : target?.answerId));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => [...overlay.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.offsetParent !== null);
    focusable()[0]?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (elements.length === 0) { event.preventDefault(); return; }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    overlay.addEventListener('keydown', trapFocus);
    return () => { overlay.removeEventListener('keydown', trapFocus); previous?.focus(); };
  }, [loadError, target?.id]);

  if (loadError) {
    return (
      <div ref={overlayRef} className="memory-study-overlay" role="dialog" aria-modal="true" aria-label="学習セッションの読込エラー">
        <div className="card memory-study-load-error" role="alert"><h2>セッションを開けませんでした</h2><p>{loadError}</p><button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'home' })}>暗記ホームへ戻る</button></div>
      </div>
    );
  }

  if (!session || !bundle || !queue || !target || !sense || !progress) {
    return <div ref={overlayRef} className="memory-study-overlay" role="dialog" aria-modal="true" aria-label="学習セッションを復元中"><div className="memory-study-loading">学習セッションを復元しています…</div></div>;
  }

  const correctButtonDisabled = busy || (target.mode === 'output' && answers.length > 1 && !selectedAnswerId && !grade?.matchedAnswerId);
  const modelAnswers = answers.length > 0 ? answers : bundle.answers.filter((answer) => answer.senseId === sense.id
    && (session.config.includeUnverifiedAi || answer.verificationStatus === 'verified'));
  const exerciseMultipleChoice = exercise?.type === 'multiple_choice';
  const multipleChoice = exerciseMultipleChoice || inputUsesChoice;
  const distractors = exerciseMultipleChoice
    ? buildAnswerChoiceDistractors({
        content: bundle,
        senseId: sense.id,
        correctAnswers: answers,
        seed: `${session.seed}:${target.id}`,
        includeUnverifiedAi: session.config.includeUnverifiedAi,
      })
    : [];
  const reorderSource = exercise?.type === 'reorder' ? answers[0]?.displayForm ?? '' : '';
  const scrambledTokens = reorderSource.split(/\s+/u).filter(Boolean).reverse();
  const chosenTokens = typedAnswer.split(/\s+/u).filter(Boolean);
  const remainingReorderTokens = (() => {
    const remaining = [...scrambledTokens];
    for (const token of chosenTokens) {
      const index = remaining.indexOf(token);
      if (index >= 0) remaining.splice(index, 1);
    }
    return remaining;
  })();
  const compositionCheck = isComposition && exercise
    ? inspectCompositionAnswer(typedAnswer, exercise)
    : undefined;
  const exerciseChoiceAnswers = exerciseMultipleChoice
    ? [...answers, ...distractors].sort((left, right) => left.id.localeCompare(right.id))
    : [];
  const moveRadioSelection = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const radios = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])];
    const currentIndex = radios.indexOf(event.currentTarget);
    if (currentIndex < 0 || radios.length < 2) return;
    event.preventDefault();
    const backwards = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    const nextIndex = (currentIndex + (backwards ? -1 : 1) + radios.length) % radios.length;
    radios[nextIndex].focus();
    radios[nextIndex].click();
  };

  return (
    <div ref={overlayRef} className="memory-study-overlay" role="dialog" aria-modal="true" aria-label="全画面暗記学習">
      <header className="memory-study-header">
        <button type="button" className="memory-study-icon" aria-label="学習を閉じて途中保存" onClick={() => navigate({ name: 'home' })}><X size={23} /></button>
        <div className="memory-study-progress"><b>完了 {progress.graduated} / {progress.total}</b><span>回答 {progress.answerCount}回</span></div>
        <button type="button" className="memory-study-icon" aria-label="最後の回答を取り消す" disabled={!queue.undo || busy} onClick={() => void undo()}><RotateCcw size={21} /></button>
      </header>
      <div className="memory-study-mode">{modeLabel(target.mode)}{queue.currentSelectionRelaxedInterval && <span>少数問題のため間隔を調整</span>}</div>

      <main className="memory-study-stage">
        <article
          className={`memory-study-card ${revealed ? 'revealed' : ''}`}
          aria-live="polite"
          onClick={() => { if (!usesTypedAnswer && !revealed) reveal(); }}
          onPointerDown={(event) => setPointerStart(event.clientX)}
          onPointerUp={(event) => {
            if (pointerStart === undefined || !revealed || busy) return;
            const distance = event.clientX - pointerStart;
            setPointerStart(undefined);
            // Typed grading and unknown-answer confirmation require the visible
            // confirmation controls; gestures must never bypass their result.
            if (distance < -60 && !grade) void commit('incorrect');
            if (distance > 60 && !grade && !correctButtonDisabled) {
              void commit('correct', selectedAnswerId ?? (target.mode === 'output' ? answers[0]?.id : target.answerId));
            }
          }}
        >
          <div className="memory-question-type">{exercise?.type.replace(/_/g, ' ') ?? (inputUsesChoice ? 'multiple choice' : 'flashcard')}</div>
          {exercise?.context && <p className="memory-question-context">{exercise.context}</p>}
          <h1>{prompt.split('\n').map((line) => <span key={line}>{line}</span>)}</h1>

          {!revealed && (usesTypedAnswer || inputUsesChoice) && (
            <div className="memory-typed-area" onClick={(event) => event.stopPropagation()}>
              {multipleChoice ? (
                <div className="memory-choice-grid" role="radiogroup" aria-label={inputUsesChoice ? '日本語の意味を選択' : '正しい英語表現を選択'}>
                  {inputUsesChoice
                    ? inputMeaningChoices.map((choice) => (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={selectedInputSenseId === choice.senseId}
                          tabIndex={(selectedInputSenseId ?? inputMeaningChoices[0]?.senseId) === choice.senseId ? 0 : -1}
                          key={choice.senseId}
                          className={selectedInputSenseId === choice.senseId ? 'active' : ''}
                          onClick={() => { setSelectedInputSenseId(choice.senseId); setTypedAnswer(choice.label); }}
                          onKeyDown={moveRadioSelection}
                        >
                          {choice.label}
                        </button>
                      ))
                    : exerciseChoiceAnswers.map((answer) => (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={selectedAnswerId === answer.id}
                          tabIndex={(selectedAnswerId ?? exerciseChoiceAnswers[0]?.id) === answer.id ? 0 : -1}
                          key={answer.id}
                          className={selectedAnswerId === answer.id ? 'active' : ''}
                          onClick={() => { setSelectedAnswerId(answer.id); setTypedAnswer(answer.displayForm); }}
                          onKeyDown={moveRadioSelection}
                        >
                          {answer.displayForm}
                        </button>
                      ))}
                </div>
              ) : exercise?.type === 'reorder' && scrambledTokens.length > 0 ? (
                <div className="memory-reorder" aria-label="語順整序の回答">
                  <div className="memory-reorder-answer" aria-live="polite">{typedAnswer || '語句を順に選択してください'}</div>
                  <div className="memory-reorder-tokens">
                    {remainingReorderTokens.map((token, index) => <button type="button" key={`${token}-${index}`} onClick={() => setTypedAnswer((current) => `${current} ${token}`.trim())}>{token}</button>)}
                  </div>
                  <button type="button" className="btn btn-ghost" disabled={!typedAnswer} onClick={() => setTypedAnswer('')}>並べ直す</button>
                </div>
              ) : isComposition ? (
                <textarea ref={answerInput as React.RefObject<HTMLTextAreaElement>} value={typedAnswer} onChange={(event) => setTypedAnswer(event.target.value)} placeholder="自分の英文を入力" aria-label="英作文の回答" />
              ) : (
                <input ref={answerInput as React.RefObject<HTMLInputElement>} value={typedAnswer} onChange={(event) => setTypedAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitTyped(); }} placeholder={target.mode === 'input' ? '日本語で回答' : '英語で回答'} aria-label="回答を入力" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
              )}
              <button type="button" className="btn btn-primary" disabled={!typedAnswer.trim()} onClick={submitTyped}>回答する</button>
            </div>
          )}

          {!revealed && !usesTypedAnswer && !inputUsesChoice && <button type="button" className="memory-reveal-button" onClick={reveal}><Eye size={20} />タップして答えを見る</button>}

          {revealed && (
            <div className="memory-answer-reveal">
              {target.mode === 'input' ? (
                <><h2>{sense.promptJa}</h2>{allItemSenses.length > 1 && !examples[0] && <ul>{allItemSenses.map((value) => <li key={value.id}>{value.meaningJa}</li>)}</ul>}</>
              ) : (
                <div className="memory-model-answers">
                  {modelAnswers.map((answer) => (
                    <button
                      type="button"
                      key={answer.id}
                      className={selectedAnswerId === answer.id || grade?.matchedAnswerId === answer.id ? 'selected' : ''}
                      onClick={() => (target.mode === 'output' || target.mode === 'composition') && setSelectedAnswerId(answer.id)}
                      aria-pressed={selectedAnswerId === answer.id}
                    >
                      <b>{answer.displayForm}</b>{answer.nuance && <small>{answer.nuance}</small>}
                    </button>
                  ))}
                  {target.mode === 'output' && modelAnswers.length > 1 && <p>言えた表現を1つ選んでください。選んだAnswerだけに成績が付きます。</p>}
                  {target.mode === 'composition' && modelAnswers.length > 1 && <p>使った、または最も近い表現を選ぶと、そのAnswerにも成績が付きます。未選択なら問題だけを評価します。</p>}
                </div>
              )}
              {typedAnswer && <div className="memory-your-answer"><small>あなたの回答</small><b>{typedAnswer}</b></div>}
              {grade?.assessment === 'partial' && <div className="memory-partial-feedback"><b>ほぼ合ってる</b><span>{grade.suggestedAnswer ?? modelAnswers[0]?.displayForm} を確認</span></div>}
              {grade?.matchKind === 'registered_other_answer' && <div className="memory-error">別の意味・文脈で登録済みの表現です：{grade.suggestedAnswer}</div>}
              {compositionCheck && (
                <div className="memory-composition-check" aria-label="英作文セルフチェック">
                  <b>自分で最終評価してください</b>
                  <span>指定構文・意味</span><span>語順</span><span>時制</span><span>冠詞</span><span>前置詞</span><span>語形</span>
                  {exercise?.requiredTokens?.map((token) => <span key={`required-${token}`} className={compositionCheck.missingRequiredTokens.includes(token) ? 'missing' : 'ok'}>必須「{token}」{compositionCheck.missingRequiredTokens.includes(token) ? 'なし' : 'あり'}</span>)}
                  {compositionCheck.presentForbiddenTokens.map((token) => <span key={`forbidden-${token}`} className="missing">禁止語「{token}」を含みます</span>)}
                </div>
              )}
              {exercise?.explanation && <p className="memory-explanation">{exercise.explanation}</p>}
              {examples[0] && <div className="memory-example"><span>{examples[0].english}</span>{examples[0].japanese && <small>{examples[0].japanese}</small>}</div>}
            </div>
          )}
        </article>

        {!revealed && exercise?.hint && <button type="button" className="memory-hint" onClick={() => { setHintUsed(true); toast(exercise.hint ?? ''); }}><Lightbulb size={17} />ヒント</button>}

        {revealed && grade?.needsUserConfirmation && (
          <div className="memory-unregistered card">
            <p>{target.mode === 'input' ? '登録表現と異なる自然な日本語ですか？' : '登録外の自然な回答ですか？'}</p>
            <div><button type="button" className="btn btn-ghost" onClick={() => void resolveUnknown('once')}>今回だけ正解</button>{target.mode !== 'input' && <button type="button" className="btn btn-primary" onClick={() => void resolveUnknown('add')}>正解表現として登録</button>}<button type="button" className="btn btn-ghost" onClick={() => void resolveUnknown('incorrect')}>不正解</button></div>
          </div>
        )}

        {revealed && !grade?.needsUserConfirmation && (
          <div className="memory-assessment-panel">
            {(grade?.assessment !== 'correct' || !grade) && (
              <div className="memory-error-types" aria-label="ミス分類">
                {ERROR_LABELS.map(([value, label]) => <label key={value} className={errorTypes.includes(value) ? 'active' : ''}><input type="checkbox" checked={errorTypes.includes(value)} onChange={(event) => setErrorTypes((current) => event.target.checked ? [...new Set([...current, value])] : current.filter((type) => type !== value))} />{label}</label>)}
              </div>
            )}
            <div className="memory-assessment-buttons">
              {grade ? (
                <button type="button" className={`memory-grade-confirm ${grade.assessment}`} disabled={busy} onClick={() => void commit(grade.assessment, grade.matchedAnswerId)}>{grade.assessment === 'correct' ? '正解・次へ' : grade.assessment === 'partial' ? '部分正解・次へ' : '不正解・次へ'}</button>
              ) : (
                <>
                  <button type="button" className="memory-again" disabled={busy} onClick={() => void commit('incorrect')}><ChevronLeft size={20} />まだ</button>
                  {isComposition && <button type="button" className="memory-partial" disabled={busy} onClick={() => void commit('partial', selectedAnswerId ?? target.answerId)}>部分的</button>}
                  <button type="button" className="memory-good" disabled={correctButtonDisabled} onClick={() => void commit('correct', selectedAnswerId ?? (target.mode === 'output' ? answers[0]?.id : target.answerId))}>覚えた</button>
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
