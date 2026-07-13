import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Play } from 'lucide-react';
import type { MemoryQuestionCount, MemorySessionConfig, MemoryStudyDirection } from '../domain/types';
import { generateLearningTargets, resolveQuestionCount } from '../domain/targets';
import { createStudySession } from '../application/session';
import { Disclosure } from '../../../components/ui/bits';
import { useToast } from '../../../components/ui/Toast';
import { useMemory } from './MemoryContext';

type CountChoice = 'weak10' | '20' | 'all' | 'auto';
type StudyStyle = 'flashcard' | 'typed_output' | 'multiple_choice';

function studyStyleLabel(style: StudyStyle): string {
  if (style === 'typed_output') return '入力式';
  if (style === 'multiple_choice') return 'Input選択式';
  return '高速カード';
}

function questionCount(choice: CountChoice): MemoryQuestionCount {
  if (choice === 'weak10') return { type: 'weak', count: 10 };
  if (choice === '20') return { type: 'count', count: 20 };
  if (choice === 'all') return { type: 'all' };
  return { type: 'auto' };
}

export function MemoryStudySetup({ initialSetIds }: { initialSetIds: string[] }) {
  const { repository, sets, navigate, refresh } = useMemory();
  const toast = useToast();
  const [selectedSetIds, setSelectedSetIds] = useState(() => [...new Set(initialSetIds)]);
  const [countChoice, setCountChoice] = useState<CountChoice>('weak10');
  const [direction, setDirection] = useState<MemoryStudyDirection>('output');
  const [style, setStyle] = useState<StudyStyle>('flashcard');
  const [includeUnverifiedAi, setIncludeUnverifiedAi] = useState(false);
  const [eligibleCount, setEligibleCount] = useState(0);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!repository || selectedSetIds.length === 0) {
      setEligibleCount(0);
      return;
    }
    let cancelled = false;
    void repository.loadSetBundle(selectedSetIds).then((bundle) => {
      const targets = generateLearningTargets({
        content: bundle,
        setMembers: bundle.setMembers,
        selectedSetIds,
        direction,
        includeUnverifiedAi,
      });
      // Answer style changes only ordinary flashcards. Context/Composition
      // exercises remain eligible because their format carries learning meaning.
      if (!cancelled) setEligibleCount(targets.length);
    });
    return () => { cancelled = true; };
  }, [direction, includeUnverifiedAi, repository, selectedSetIds]);

  const plannedCount = useMemo(() => resolveQuestionCount(eligibleCount, questionCount(countChoice)), [countChoice, eligibleCount]);

  const start = async () => {
    if (!repository || starting) return;
    setStarting(true);
    try {
      const config: MemorySessionConfig = {
        questionCount: questionCount(countChoice),
        direction,
        includeUnverifiedAi,
        preferredExerciseType: style,
      };
      const created = await createStudySession({ repository, selectedSetIds, config });
      await refresh();
      navigate({ name: 'study', sessionId: created.session.id });
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '学習を開始できませんでした');
    } finally {
      setStarting(false);
    }
  };

  return (
    <section className="memory-study-setup">
      <div className="memory-page-header">
        <button type="button" className="icon-btn" aria-label="暗記ホームへ戻る" onClick={() => navigate({ name: 'home' })}><ArrowLeft size={21} /></button>
        <div><h2>学習設定</h2><p>普段は初期設定のまますぐ始められます</p></div>
      </div>
      <div className="card memory-setup-card">
        <fieldset>
          <legend>学習するセット</legend>
          <div className="memory-set-chips">
            {sets.map((set) => {
              const checked = selectedSetIds.includes(set.id);
              return <label key={set.id} className={checked ? 'active' : ''}><input type="checkbox" checked={checked} onChange={(event) => setSelectedSetIds((current) => event.target.checked ? [...new Set([...current, set.id])] : current.filter((id) => id !== set.id))} />{set.name}</label>;
            })}
          </div>
        </fieldset>
        <fieldset>
          <legend>問題数</legend>
          <div className="memory-option-grid four" role="radiogroup" aria-label="問題数">
            {([['weak10', '苦手を10問'], ['20', '20問'], ['all', '全部'], ['auto', 'おまかせ']] as const).map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={countChoice === value} className={countChoice === value ? 'active' : ''} onClick={() => setCountChoice(value)}>{label}</button>)}
          </div>
        </fieldset>
        <fieldset>
          <legend>方向</legend>
          <div className="memory-option-grid four" role="radiogroup" aria-label="出題方向">
            {([['output', '日→英'], ['input', '英→日'], ['context', '文中で使う'], ['mix', 'ミックス']] as const).map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={direction === value} className={direction === value ? 'active' : ''} onClick={() => setDirection(value)}>{label}</button>)}
          </div>
        </fieldset>
        <Disclosure title="詳細設定" summary={studyStyleLabel(style)}>
          <fieldset>
            <legend>回答方式</legend>
            <div className="memory-option-grid three" role="radiogroup" aria-label="回答方式">
              <button type="button" role="radio" aria-checked={style === 'flashcard'} className={style === 'flashcard' ? 'active' : ''} onClick={() => setStyle('flashcard')}>高速カード</button>
              <button type="button" role="radio" aria-checked={style === 'typed_output'} className={style === 'typed_output' ? 'active' : ''} onClick={() => setStyle('typed_output')}>入力式</button>
              <button type="button" role="radio" aria-checked={style === 'multiple_choice'} className={style === 'multiple_choice' ? 'active' : ''} onClick={() => setStyle('multiple_choice')}>Input選択式</button>
            </div>
            {style === 'multiple_choice' && <p className="muted mt-8">英→日では日本語の選択肢を表示します。他の方向は各問題本来の形式で出題します。</p>}
          </fieldset>
          <label className="memory-check-row"><input type="checkbox" checked={includeUnverifiedAi} onChange={(event) => setIncludeUnverifiedAi(event.target.checked)} /><span><b>AI未確認データも出題</b><small>初期状態では通常学習から除外されます</small></span></label>
        </Disclosure>
        <div className="memory-start-summary" aria-live="polite">対象 {eligibleCount}件から、異なるLearning Targetを{plannedCount}問選びます。再出題はこの数に含みません。</div>
        <button type="button" className="btn btn-primary memory-primary-large" disabled={starting || selectedSetIds.length === 0 || plannedCount === 0} onClick={() => void start()}><Play size={20} fill="currentColor" />学習を始める</button>
      </div>
    </section>
  );
}
