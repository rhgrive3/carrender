import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, Play } from 'lucide-react';
import type { MemoryQuestionCount, MemorySessionConfig } from '../domain/types';
import { generateLearningTargets, resolveQuestionCount } from '../domain/targets';
import { createSimpleStudySession } from '../application/simpleSession';
import { useToast } from '../../../components/ui/Toast';
import { useMemory } from './MemoryContext';

type CountChoice = 'weak10' | '20' | 'all';
type DirectionChoice = 'output' | 'input';

const DIRECTION_CHOICES = ['output', 'input'] as const;
const COUNT_CHOICES = [
  ['weak10', '苦手中心 10問'],
  ['20', '20問'],
  ['all', '全部'],
] as const;

function questionCount(choice: CountChoice): MemoryQuestionCount {
  if (choice === '20') return { type: 'count', count: 20 };
  if (choice === 'all') return { type: 'all' };
  return { type: 'weak', count: 10 };
}

function handleRadioKeyDown<T extends string>(
  event: KeyboardEvent<HTMLButtonElement>,
  choices: readonly T[],
  current: T,
  select: (value: T) => void,
) {
  const key = event.key;
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return;
  event.preventDefault();
  const currentIndex = Math.max(0, choices.indexOf(current));
  const nextIndex = key === 'Home'
    ? 0
    : key === 'End'
      ? choices.length - 1
      : (currentIndex + (key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length;
  const next = choices[nextIndex];
  const group = event.currentTarget.parentElement;
  select(next);
  requestAnimationFrame(() => group?.querySelector<HTMLButtonElement>(`[data-radio-value="${next}"]`)?.focus());
}

export function MemoryStudySetup({ initialSetIds }: { initialSetIds: string[] }) {
  const { repository, ready, sets, activeSession, navigate, refresh, requestSync } = useMemory();
  const toast = useToast();
  const initialSelectionKey = [...new Set(initialSetIds)].sort().join('\u0000');
  const [selectedSetIds, setSelectedSetIds] = useState(() => [...new Set(initialSetIds)]);
  const [countChoice, setCountChoice] = useState<CountChoice>('weak10');
  const [direction, setDirection] = useState<DirectionChoice>('output');
  const [eligibleCount, setEligibleCount] = useState(0);
  const [resolvedEligibilityKey, setResolvedEligibilityKey] = useState<string>();
  const [eligibilityError, setEligibilityError] = useState<string>();
  const [eligibilityRetry, setEligibilityRetry] = useState(0);
  const [starting, setStarting] = useState(false);
  const mountedRef = useRef(false);
  const startInFlight = useRef(false);
  const startTokenRef = useRef(0);
  const repositoryRef = useRef(repository);
  repositoryRef.current = repository;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startTokenRef.current += 1;
      startInFlight.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    startTokenRef.current += 1;
    startInFlight.current = false;
    setStarting(false);
    setSelectedSetIds(initialSelectionKey ? initialSelectionKey.split('\u0000') : []);
    setEligibleCount(0);
    setResolvedEligibilityKey(undefined);
    setEligibilityError(undefined);
  }, [initialSelectionKey, repository]);

  useEffect(() => {
    if (!ready) return;
    const availableSetIds = new Set(sets.map((set) => set.id));
    setSelectedSetIds((current) => current.filter((setId) => availableSetIds.has(setId)));
  }, [ready, sets]);

  const eligibilityKey = useMemo(
    () => `${direction}:${[...selectedSetIds].sort().join(',')}`,
    [direction, selectedSetIds],
  );
  const eligibilityReady = selectedSetIds.length > 0 && resolvedEligibilityKey === eligibilityKey;

  useEffect(() => {
    if (!repository || selectedSetIds.length === 0) {
      setEligibleCount(0);
      setResolvedEligibilityKey(undefined);
      setEligibilityError(undefined);
      return;
    }
    let cancelled = false;
    setEligibleCount(0);
    setResolvedEligibilityKey(undefined);
    setEligibilityError(undefined);
    void repository.loadSetBundle(selectedSetIds).then((bundle) => {
      const targets = generateLearningTargets({
        content: bundle,
        setMembers: bundle.setMembers,
        selectedSetIds,
        direction,
        includeUnverifiedAi: false,
      }).filter((target) => !target.exerciseId && (target.mode === 'output' || target.mode === 'input'));
      if (!cancelled) {
        setEligibleCount(targets.length);
        setResolvedEligibilityKey(eligibilityKey);
      }
    }).catch((caught) => {
      if (cancelled) return;
      setEligibleCount(0);
      setResolvedEligibilityKey(undefined);
      setEligibilityError(caught instanceof Error ? caught.message : 'カード件数を読み込めませんでした');
    });
    return () => { cancelled = true; };
  }, [direction, eligibilityKey, eligibilityRetry, repository, selectedSetIds]);

  const plannedCount = useMemo(
    () => resolveQuestionCount(eligibleCount, questionCount(countChoice)),
    [countChoice, eligibleCount],
  );

  const start = async () => {
    if (!repository || startInFlight.current || !eligibilityReady || plannedCount === 0 || eligibilityError) return;
    if (activeSession && !window.confirm(
      `前回の暗記学習（回答${activeSession.answerCount}回）が途中です。\n前回を終了して新しい学習を始めますか？`,
    )) return;
    const actionRepository = repository;
    const actionToken = startTokenRef.current + 1;
    startTokenRef.current = actionToken;
    startInFlight.current = true;
    setStarting(true);
    const isCurrentAction = () => mountedRef.current
      && repositoryRef.current === actionRepository
      && startTokenRef.current === actionToken;
    try {
      const config: MemorySessionConfig = {
        questionCount: questionCount(countChoice),
        direction,
        includeUnverifiedAi: false,
        preferredExerciseType: 'flashcard',
      };
      const created = await createSimpleStudySession({ repository: actionRepository, selectedSetIds: [...selectedSetIds], config });
      if (isCurrentAction()) {
        try {
          await refresh();
        } catch (caught) {
          console.error('Failed to refresh memory state after creating a study session', caught);
        }
      }
      void requestSync(true).catch(() => undefined);
      if (isCurrentAction()) navigate({ name: 'study', sessionId: created.session.id });
    } catch (caught) {
      if (isCurrentAction()) toast(caught instanceof Error ? caught.message : '学習を開始できませんでした');
    } finally {
      if (startTokenRef.current === actionToken) {
        startInFlight.current = false;
        if (mountedRef.current) setStarting(false);
      }
    }
  };

  return (
    <section className="memory-study-setup memory-simple-setup" aria-busy={starting}>
      <div className="memory-page-header">
        <button type="button" className="icon-btn" aria-label="暗記ホームへ戻る" disabled={starting} onClick={() => navigate({ name: 'home' })}><ArrowLeft size={21} aria-hidden="true" /></button>
        <div><h2>学習設定</h2><p>必要な項目だけ選んで、すぐ始める</p></div>
      </div>

      {activeSession && (
        <button type="button" className="memory-simple-resume card" disabled={starting} onClick={() => navigate({ name: 'study', sessionId: activeSession.id })}>
          <ArrowRight size={22} aria-hidden="true" />
          <span><b>前回の続きへ戻る</b><small>回答 {activeSession.answerCount}回・新規開始までは保持されます</small></span>
        </button>
      )}

      <div className="card memory-setup-card">
        <fieldset disabled={starting}><legend>セット</legend><div className="memory-set-chips">{sets.map((set) => { const checked = selectedSetIds.includes(set.id); return <label key={set.id} className={checked ? 'active' : ''}><input type="checkbox" checked={checked} onChange={(event) => setSelectedSetIds((current) => event.target.checked ? [...new Set([...current, set.id])] : current.filter((id) => id !== set.id))} />{set.name}</label>; })}</div></fieldset>
        <fieldset disabled={starting}><legend>出題方向</legend><div className="memory-simple-direction" role="radiogroup" aria-label="出題方向"><button type="button" role="radio" aria-checked={direction === 'output'} tabIndex={direction === 'output' ? 0 : -1} data-radio-value="output" className={direction === 'output' ? 'active' : ''} onKeyDown={(event) => handleRadioKeyDown(event, DIRECTION_CHOICES, direction, setDirection)} onClick={() => setDirection('output')}><b>日本語 → 英語</b><span>英語を自力で思い出す</span></button><button type="button" role="radio" aria-checked={direction === 'input'} tabIndex={direction === 'input' ? 0 : -1} data-radio-value="input" className={direction === 'input' ? 'active' : ''} onKeyDown={(event) => handleRadioKeyDown(event, DIRECTION_CHOICES, direction, setDirection)} onClick={() => setDirection('input')}><b>英語 → 日本語</b><span>意味を確認する</span></button></div></fieldset>
        <fieldset disabled={starting}><legend>問題数</legend><div className="memory-option-grid three" role="radiogroup" aria-label="問題数">{COUNT_CHOICES.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={countChoice === value} tabIndex={countChoice === value ? 0 : -1} data-radio-value={value} className={countChoice === value ? 'active' : ''} onKeyDown={(event) => handleRadioKeyDown(event, COUNT_CHOICES.map(([choice]) => choice), countChoice, setCountChoice)} onClick={() => setCountChoice(value)}>{label}</button>)}</div></fieldset>
        <div className="memory-start-summary" aria-live="polite">{selectedSetIds.length === 0 ? '学習するセットを選んでください' : eligibilityError ? <span role="alert">カード件数を読み込めませんでした。<button type="button" className="btn btn-secondary" disabled={starting} onClick={() => setEligibilityRetry((current) => current + 1)}>再読み込み</button></span> : !eligibilityReady ? 'カード件数を確認中…' : eligibleCount === 0 ? '出題できるカードがありません' : `${eligibleCount}件から${plannedCount}件を出題します。間違えたカードは数問後に戻ります。`}</div>
        <button type="button" className="btn btn-primary memory-primary-large" disabled={starting || selectedSetIds.length === 0 || !eligibilityReady || plannedCount === 0 || Boolean(eligibilityError)} aria-busy={starting} onClick={() => void start()}><Play size={20} fill="currentColor" aria-hidden="true" />{starting ? '準備中…' : activeSession ? '前回を終了して新しく始める' : '学習を始める'}</button>
      </div>
    </section>
  );
}
