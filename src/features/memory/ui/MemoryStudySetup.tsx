import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Play } from 'lucide-react';
import type { MemoryQuestionCount, MemorySessionConfig } from '../domain/types';
import { generateLearningTargets, resolveQuestionCount } from '../domain/targets';
import { createSimpleStudySession } from '../application/simpleSession';
import { useToast } from '../../../components/ui/Toast';
import { useMemory } from './MemoryContext';

type CountChoice = 'weak10' | '20' | 'all';
type DirectionChoice = 'output' | 'input';

function questionCount(choice: CountChoice): MemoryQuestionCount {
  if (choice === '20') return { type: 'count', count: 20 };
  if (choice === 'all') return { type: 'all' };
  return { type: 'weak', count: 10 };
}

export function MemoryStudySetup({ initialSetIds }: { initialSetIds: string[] }) {
  const { repository, ready, sets, navigate, refresh } = useMemory();
  const toast = useToast();
  const [selectedSetIds, setSelectedSetIds] = useState(() => [...new Set(initialSetIds)]);
  const [countChoice, setCountChoice] = useState<CountChoice>('weak10');
  const [direction, setDirection] = useState<DirectionChoice>('output');
  const [eligibleCount, setEligibleCount] = useState(0);
  const [resolvedEligibilityKey, setResolvedEligibilityKey] = useState<string>();
  const [eligibilityError, setEligibilityError] = useState<string>();
  const [eligibilityRetry, setEligibilityRetry] = useState(0);
  const [starting, setStarting] = useState(false);

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
    if (!repository || starting || !eligibilityReady || plannedCount === 0 || eligibilityError) return;
    setStarting(true);
    try {
      const config: MemorySessionConfig = {
        questionCount: questionCount(countChoice),
        direction,
        includeUnverifiedAi: false,
        preferredExerciseType: 'flashcard',
      };
      const created = await createSimpleStudySession({ repository, selectedSetIds, config });
      try {
        await refresh();
      } catch (caught) {
        console.error('Failed to refresh memory state after creating a study session', caught);
      }
      navigate({ name: 'study', sessionId: created.session.id });
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '学習を開始できませんでした');
    } finally {
      setStarting(false);
    }
  };

  return (
    <section className="memory-study-setup memory-simple-setup">
      <div className="memory-page-header">
        <button type="button" className="icon-btn" aria-label="暗記ホームへ戻る" onClick={() => navigate({ name: 'home' })}><ArrowLeft size={21} /></button>
        <div><h2>学習設定</h2><p>必要な項目だけ選んで、すぐ始める</p></div>
      </div>

      <div className="card memory-setup-card">
        <fieldset>
          <legend>セット</legend>
          <div className="memory-set-chips">
            {sets.map((set) => {
              const checked = selectedSetIds.includes(set.id);
              return <label key={set.id} className={checked ? 'active' : ''}><input type="checkbox" checked={checked} onChange={(event) => setSelectedSetIds((current) => event.target.checked ? [...new Set([...current, set.id])] : current.filter((id) => id !== set.id))} />{set.name}</label>;
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend>出題方向</legend>
          <div className="memory-simple-direction" role="radiogroup" aria-label="出題方向">
            <button type="button" role="radio" aria-checked={direction === 'output'} className={direction === 'output' ? 'active' : ''} onClick={() => setDirection('output')}><b>日本語 → 英語</b><span>英語を自力で思い出す</span></button>
            <button type="button" role="radio" aria-checked={direction === 'input'} className={direction === 'input' ? 'active' : ''} onClick={() => setDirection('input')}><b>英語 → 日本語</b><span>意味を確認する</span></button>
          </div>
        </fieldset>

        <fieldset>
          <legend>問題数</legend>
          <div className="memory-option-grid three" role="radiogroup" aria-label="問題数">
            {([['weak10', '苦手中心 10問'], ['20', '20問'], ['all', '全部']] as const).map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={countChoice === value} className={countChoice === value ? 'active' : ''} onClick={() => setCountChoice(value)}>{label}</button>)}
          </div>
        </fieldset>

        <div className="memory-start-summary" aria-live="polite">
          {selectedSetIds.length === 0
            ? '学習するセットを選んでください'
            : eligibilityError
              ? <span role="alert">カード件数を読み込めませんでした。<button type="button" className="btn btn-secondary" onClick={() => setEligibilityRetry((current) => current + 1)}>再読み込み</button></span>
              : !eligibilityReady
                ? 'カード件数を確認中…'
                : eligibleCount === 0
                  ? '出題できるカードがありません'
                  : `${eligibleCount}件から${plannedCount}件を出題します。間違えたカードは数問後に戻ります。`}
        </div>
        <button type="button" className="btn btn-primary memory-primary-large" disabled={starting || selectedSetIds.length === 0 || !eligibilityReady || plannedCount === 0 || Boolean(eligibilityError)} onClick={() => void start()}><Play size={20} fill="currentColor" />{starting ? '準備中…' : '学習を始める'}</button>
      </div>
    </section>
  );
}
