import { useEffect, useMemo, useState } from 'react';
import { APP_TIME_ZONE } from '../../../lib/date';
import { ArrowLeft } from 'lucide-react';
import type { ErrorType, MemoryAttempt, MemorySession, MemorySetBundle, MemoryStat } from '../domain/types';
import { generateLearningTargets, summarizeLearningTargetStats } from '../domain/selectors';
import { useMemory } from './MemoryContext';

const ERROR_LABEL: Record<ErrorType, string> = {
  meaning: '意味が出ない', recall: '英語が出ない', spelling: 'スペルミス', word_form: '語形ミス', article: '冠詞ミス',
  preposition: '前置詞ミス', word_order: '語順ミス', tense: '時制ミス', agreement: '一致ミス', register: '文体・語調', context: '文脈ミス', other: 'その他',
};

function formatMastery(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

export function MemoryAnalytics({ setIds }: { setIds: string[] }) {
  const { repository, navigate } = useMemory();
  const [bundle, setBundle] = useState<MemorySetBundle>();
  const [stats, setStats] = useState<MemoryStat[]>([]);
  const [sessions, setSessions] = useState<MemorySession[]>([]);
  const [attempts, setAttempts] = useState<MemoryAttempt[]>([]);

  useEffect(() => {
    if (!repository) return;
    void (async () => {
      const content = await repository.loadSetBundle(setIds);
      const targetIds = new Set([...content.senses, ...content.answers, ...content.exercises].map((record) => record.id));
      const recentSessions = (await repository.listSessions(20)).filter((session) => session.selectedSetIds.some((id) => setIds.includes(id)));
      const recentAttempts = (await Promise.all(recentSessions.slice(0, 10).map((session) => repository.getSessionAttempts(session.id)))).flat();
      setBundle(content); setStats(await repository.getStats(targetIds)); setSessions(recentSessions); setAttempts(recentAttempts);
    })();
  }, [repository, setIds]);

  const targets = useMemo(() => bundle ? generateLearningTargets({
    content: bundle,
    setMembers: bundle.setMembers,
    selectedSetIds: setIds,
    direction: 'mix',
    includeUnverifiedAi: true,
  }) : [], [bundle, setIds]);
  const summary = useMemo(
    () => summarizeLearningTargetStats(targets, stats),
    [stats, targets],
  );
  const targetsBySense = useMemo(() => {
    const grouped = new Map<string, typeof targets>();
    for (const target of targets) {
      const values = grouped.get(target.senseId) ?? [];
      grouped.set(target.senseId, [...values, target]);
    }
    return grouped;
  }, [targets]);
  const gaps = useMemo(() => (bundle?.senses ?? []).map((sense) => {
    const senseSummary = summarizeLearningTargetStats(targetsBySense.get(sense.id) ?? [], stats);
    const input = senseSummary.mastery.byMode.input.mastery;
    const output = senseSummary.mastery.byMode.output.mastery;
    const context = senseSummary.mastery.byMode.context.mastery;
    const composition = senseSummary.mastery.byMode.composition.mastery;
    const item = bundle?.items.find((value) => value.id === sense.itemId);
    return { sense, item, input, output, context, composition, gap: (input ?? 0) - (output ?? 0) };
  }).filter((row) => row.input !== null || row.output !== null || row.context !== null || row.composition !== null)
    .sort((left, right) => right.gap - left.gap), [bundle, stats, targetsBySense]);
  const errors = useMemo(() => {
    const counts = new Map<ErrorType, number>();
    for (const attempt of attempts) for (const type of attempt.errorTypes) counts.set(type, (counts.get(type) ?? 0) + 1);
    return [...counts].sort((left, right) => right[1] - left[1]);
  }, [attempts]);
  const needsReview = new Set(sessions.flatMap((session) => session.needsReviewTargetIds)).size;

  if (!bundle) return <div className="card memory-loading">分析を準備しています…</div>;

  return (
    <section className="memory-analytics">
      <div className="memory-page-header">
        <button type="button" className="icon-btn" aria-label="戻る" onClick={() => navigate(setIds.length === 1 ? { name: 'set', setId: setIds[0] } : { name: 'home' })}><ArrowLeft size={21} /></button>
        <div><h2>苦手分析</h2><p>{bundle.sets.map((set) => set.name).join('・')}</p></div>
      </div>
      <div className="memory-analytics-summary">
        <div className="card"><small>登録Sense</small><b>{bundle.senses.length}</b></div>
        <div className="card"><small>Output</small><b>{formatMastery(summary.mastery.byMode.output.mastery)}</b></div>
        <div className="card"><small>Input</small><b>{formatMastery(summary.mastery.byMode.input.mastery)}</b></div>
        <div className="card"><small>Context</small><b>{formatMastery(summary.mastery.byMode.context.mastery)}</b></div>
        <div className="card"><small>Composition</small><b>{formatMastery(summary.mastery.byMode.composition.mastery)}</b></div>
        <div className="card"><small>苦手</small><b>{summary.weakSenseCount}</b></div>
        <div className="card"><small>要確認</small><b>{needsReview}</b></div>
        <div className="card"><small>未出題</small><b>{summary.unattemptedSenseCount}</b></div>
      </div>
      <div className="memory-analytics-columns">
        <article className="card">
          <h3>Input／Output差</h3><p className="muted">「意味は分かるが英語が出ない」項目を優先表示</p>
          <div className="memory-gap-list">{gaps.slice(0, 30).map((row) => <div key={row.sense.id}><b>{row.item?.label ?? row.sense.promptJa}</b><span>Input {formatMastery(row.input)}</span><span>Output {formatMastery(row.output)}</span><span>Context {formatMastery(row.context)}</span><span>Composition {formatMastery(row.composition)}</span></div>)}</div>
        </article>
        <article className="card">
          <h3>ミスの内訳</h3>
          {errors.length === 0 ? <p className="muted">まだ分類されたミスはありません。</p> : <div className="memory-error-chart">{errors.map(([type, count]) => <div key={type}><span>{ERROR_LABEL[type]}</span><i><em style={{ width: `${Math.min(100, count / Math.max(1, errors[0][1]) * 100)}%` }} /></i><b>{count}</b></div>)}</div>}
        </article>
      </div>
      <article className="card memory-recent-sessions">
        <h3>最近の成績</h3>
        {sessions.slice(0, 10).map((session) => {
          const rows = attempts.filter((attempt) => attempt.sessionId === session.id);
          const assessmentCounts = {
            correct: rows.filter((attempt) => attempt.assessment === 'correct').length,
            partial: rows.filter((attempt) => attempt.assessment === 'partial').length,
            incorrect: rows.filter((attempt) => attempt.assessment === 'incorrect').length,
            skipped: rows.filter((attempt) => attempt.assessment === 'skipped').length,
          };
          return <div key={session.id}><span><b>{new Date(session.createdAt).toLocaleDateString('ja-JP', { timeZone: APP_TIME_ZONE })}</b><small>{bundle.sets.filter((set) => session.selectedSetIds.includes(set.id)).map((set) => set.name).join('・')}</small></span><span>回答 {session.answerCount}</span><span>正解 {assessmentCounts.correct}・部分 {assessmentCounts.partial}・不正解 {assessmentCounts.incorrect}・スキップ {assessmentCounts.skipped}</span><span>要確認 {session.needsReviewTargetIds.length}</span><span>平均 {rows.length ? (rows.reduce((sum, attempt) => sum + attempt.responseMs, 0) / rows.length / 1000).toFixed(1) : '—'}秒</span></div>;
        })}
      </article>
    </section>
  );
}
