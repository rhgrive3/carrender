import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BarChart3, BookOpenCheck, Download, Plus, RefreshCw, Search } from 'lucide-react';
import type { MemoryLocalSnapshot } from '../infrastructure/repositories';
import type { MemorySession, MemorySet } from '../domain/types';
import { generateLearningTargets, summarizeLearningTargetStats } from '../domain/selectors';
import { createMemorySet } from '../application/content';
import { useMemory } from './MemoryContext';
import { MemoryDialog } from './MemoryDialog';
import { MemoryConflictsDialog } from './MemoryConflictsDialog';

interface SetSummary {
  set: MemorySet;
  senseCount: number;
  weakCount: number;
  unattemptedCount: number;
  mastery: number | null;
  input: number | null;
  output: number | null;
  context: number | null;
  composition: number | null;
}

function summarizeSets(snapshot: MemoryLocalSnapshot): SetSummary[] {
  const sensesByItem = new Map<string, string[]>();
  for (const sense of snapshot.senses) {
    const values = sensesByItem.get(sense.itemId) ?? [];
    values.push(sense.id);
    sensesByItem.set(sense.itemId, values);
  }
  const membersBySet = new Map<string, string[]>();
  for (const member of snapshot.setMembers) {
    const values = membersBySet.get(member.setId) ?? [];
    values.push(member.itemId);
    membersBySet.set(member.setId, values);
  }
  return snapshot.sets.map((set) => {
    const senseIds = new Set((membersBySet.get(set.id) ?? []).flatMap((itemId) => sensesByItem.get(itemId) ?? []));
    const targets = generateLearningTargets({
      content: snapshot,
      setMembers: snapshot.setMembers,
      selectedSetIds: [set.id],
      direction: 'mix',
      includeUnverifiedAi: true,
    });
    const summary = summarizeLearningTargetStats(targets, snapshot.stats);
    return {
      set,
      senseCount: senseIds.size,
      weakCount: summary.weakSenseCount,
      unattemptedCount: summary.unattemptedSenseCount,
      mastery: summary.mastery.overall,
      input: summary.mastery.byMode.input.mastery,
      output: summary.mastery.byMode.output.mastery,
      context: summary.mastery.byMode.context.mastery,
      composition: summary.mastery.byMode.composition.mastery,
    };
  });
}

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function CreateSetDialog({ onClose }: { onClose: () => void }) {
  const { repository, refresh, requestSync } = useMemory();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!repository || saving) return;
    setSaving(true);
    setError('');
    try {
      await createMemorySet(repository, { name, description });
      await refresh();
      void requestSync(true);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'セットを保存できませんでした');
    } finally {
      setSaving(false);
    }
  };
  return (
    <MemoryDialog
      title="暗記セットを追加"
      onClose={onClose}
      footer={<button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>セットを保存</button>}
    >
      <div className="field">
        <label htmlFor="memory-set-name">セット名</label>
        <input id="memory-set-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例：LEAP 1〜300" />
      </div>
      <div className="field">
        <label htmlFor="memory-set-description">説明（任意）</label>
        <textarea id="memory-set-description" value={description} onChange={(event) => setDescription(event.target.value)} />
      </div>
      {error && <div className="memory-error" role="alert">{error}</div>}
    </MemoryDialog>
  );
}

export function MemoryHome() {
  const {
    repository,
    ready,
    error,
    activeSession,
    syncStatus,
    syncError,
    pendingCount,
    conflictCount,
    navigate,
    requestSync,
  } = useMemory();
  const [snapshot, setSnapshot] = useState<MemoryLocalSnapshot | null>(null);
  const [selectedSetId, setSelectedSetId] = useState<string>();
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(100);
  const [createSetOpen, setCreateSetOpen] = useState(false);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [recentSessions, setRecentSessions] = useState<MemorySession[]>([]);

  useEffect(() => {
    if (!repository || !ready) return;
    let cancelled = false;
    void Promise.all([repository.loadSnapshot(), repository.listSessions(10)]).then(([value, sessions]) => {
      if (cancelled) return;
      setSnapshot(value);
      setRecentSessions(sessions);
      setSelectedSetId((current) => current ?? value.sets[0]?.id);
    });
    return () => { cancelled = true; };
  }, [repository, ready, pendingCount]);

  const summaries = useMemo(() => snapshot ? summarizeSets(snapshot) : [], [snapshot]);
  const normalizedQuery = query.normalize('NFKC').trim().toLocaleLowerCase('ja-JP');
  const filtered = summaries.filter((summary) => !normalizedQuery
    || `${summary.set.name} ${summary.set.description ?? ''} ${summary.set.tags.join(' ')}`
      .normalize('NFKC').toLocaleLowerCase('ja-JP').includes(normalizedQuery));
  const selected = summaries.find((summary) => summary.set.id === selectedSetId) ?? filtered[0];
  const chosenSetIds = selected ? [selected.set.id] : summaries.map((summary) => summary.set.id);
  const selectedRecent = selected
    ? recentSessions.find((session) => session.selectedSetIds.includes(selected.set.id))
    : recentSessions[0];
  const selectedWeakTags = (() => {
    if (!snapshot || !selected) return [] as string[];
    const itemIds = new Set(snapshot.setMembers.filter((member) => member.setId === selected.set.id).map((member) => member.itemId));
    const weakTargetIds = new Set(snapshot.stats.filter((stat) => stat.weaknessScore >= 60 || stat.manualWeak).map((stat) => stat.targetId));
    const weakSenseIds = new Set([
      ...snapshot.senses.filter((sense) => weakTargetIds.has(sense.id)).map((sense) => sense.id),
      ...snapshot.answers.filter((answer) => weakTargetIds.has(answer.id)).map((answer) => answer.senseId),
      ...snapshot.exercises.filter((exercise) => weakTargetIds.has(exercise.id)).map((exercise) => exercise.senseId),
    ]);
    const weakItemIds = new Set(snapshot.senses.filter((sense) => weakSenseIds.has(sense.id)).map((sense) => sense.itemId));
    const counts = new Map<string, number>();
    snapshot.items.filter((item) => itemIds.has(item.id) && weakItemIds.has(item.id)).forEach((item) => item.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
    return [...counts].sort((left, right) => right[1] - left[1]).slice(0, 4).map(([tag]) => tag);
  })();

  if (!ready) return <div className="card memory-loading" aria-live="polite">端末内の暗記データを開いています…</div>;
  if (error) return <div className="card memory-error" role="alert">{error}</div>;

  return (
    <section className="memory-home" aria-label="暗記カードホーム">
      <div className="memory-toolbar">
        <div>
          <h2>暗記カード</h2>
          <p>オフラインで学習・編集できます</p>
        </div>
        <div className="memory-toolbar-actions">
          <button type="button" className="btn btn-ghost" onClick={() => navigate({ name: 'import', setId: selected?.set.id })}>
            <Download size={18} aria-hidden="true" />取込・出力
          </button>
          <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'editor', setId: selected?.set.id })}>
            <Plus size={18} aria-hidden="true" />追加
          </button>
        </div>
      </div>

      <div className="memory-sync-line" aria-live="polite">
        <span className={`memory-sync-dot ${syncStatus}`} aria-hidden="true" />
        {syncStatus === 'offline'
          ? 'オフライン・端末へ保存済み'
          : syncStatus === 'syncing'
            ? '端末へ保存済み・同期中'
            : syncStatus === 'conflict'
              ? '端末へ保存済み・差分確認が必要です'
              : syncStatus === 'error'
                ? '端末へ保存済み・サーバー同期に失敗'
                : '端末へ保存済み'}
        {pendingCount > 0 && `・同期待ち ${pendingCount}件`}
        {syncStatus === 'error' && syncError && <span className="memory-sync-error" role="alert">・{syncError}</span>}
        {conflictCount > 0 && <button type="button" className="memory-inline-button" onClick={() => setConflictsOpen(true)}>競合 {conflictCount}件を確認</button>}
        <button type="button" className="memory-inline-button" onClick={() => void requestSync(true)} aria-label="暗記データを同期">
          <RefreshCw size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="memory-quick-actions" aria-label="クイック学習">
        <button type="button" disabled={chosenSetIds.length === 0} onClick={() => navigate({ name: 'studySetup', setIds: chosenSetIds })}>
          <BookOpenCheck size={20} aria-hidden="true" /><span><b>苦手を10問</b><small>日→英・高速カード</small></span>
        </button>
        <button
          type="button"
          disabled={!activeSession}
          onClick={() => activeSession && navigate({ name: 'study', sessionId: activeSession.id })}
        >
          <ArrowRight size={20} aria-hidden="true" /><span><b>前回の続き</b><small>{activeSession ? `回答 ${activeSession.answerCount}回` : '途中セッションなし'}</small></span>
        </button>
        <button type="button" disabled={summaries.length === 0} onClick={() => navigate({ name: 'studySetup', setIds: summaries.map((summary) => summary.set.id) })}>
          <Search size={20} aria-hidden="true" /><span><b>カードを選ぶ</b><small>複数セット対応</small></span>
        </button>
      </div>

      {summaries.length === 0 ? (
        <div className="card empty-state memory-empty">
          <span className="empty-icon" aria-hidden="true">🗂️</span>
          <div className="empty-title">暗記セットを作成しましょう</div>
          <p>セットを作った後、1枚入力または複数行貼り付けですぐ登録できます。</p>
          <button type="button" className="btn btn-primary" onClick={() => setCreateSetOpen(true)}>最初のセットを作る</button>
        </div>
      ) : (
        <div className="memory-master-detail">
          <div className="memory-set-list-panel">
            <div className="memory-panel-heading">
              <label className="memory-search">
                <Search size={17} aria-hidden="true" />
                <span className="sr-only">セットを検索</span>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="セット・タグを検索" />
              </label>
              <button type="button" className="icon-btn" aria-label="暗記セットを追加" onClick={() => setCreateSetOpen(true)}><Plus size={20} /></button>
            </div>
            <div className="memory-set-list" role="listbox" aria-label="暗記セット">
              {filtered.slice(0, visibleCount).map((summary) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={selected?.set.id === summary.set.id}
                  key={summary.set.id}
                  className={selected?.set.id === summary.set.id ? 'active' : ''}
                  onClick={() => setSelectedSetId(summary.set.id)}
                  onDoubleClick={() => navigate({ name: 'set', setId: summary.set.id })}
                >
                  <span><b>{summary.set.name}</b><small>{summary.senseCount}項目・英語</small><small>習得 {percent(summary.mastery)}・苦手 {summary.weakCount}項目</small></span>
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              ))}
            </div>
            {filtered.length > visibleCount && (
              <button type="button" className="btn btn-ghost memory-load-more" onClick={() => setVisibleCount((value) => value + 100)}>さらに100件表示</button>
            )}
          </div>

          {selected && (
            <aside className="memory-set-overview" aria-label={`${selected.set.name}の概要`}>
              <div className="row spread">
                <div><h3>{selected.set.name}</h3><p>{selected.set.description || `${selected.senseCount}の意味単位`}</p></div>
                <button type="button" className="btn btn-ghost" onClick={() => navigate({ name: 'set', setId: selected.set.id })}>詳細</button>
              </div>
              <div className="memory-mastery-grid">
                <span><small>Input</small><b>{percent(selected.input)}</b></span>
                <span><small>Output</small><b>{percent(selected.output)}</b></span>
                <span><small>Context</small><b>{percent(selected.context)}</b></span>
                <span><small>Composition</small><b>{percent(selected.composition)}</b></span>
                <span><small>苦手</small><b>{selected.weakCount}</b></span>
              </div>
              <div className="memory-overview-note">
                <BarChart3 size={18} aria-hidden="true" />未出題 {selected.unattemptedCount}項目。習得率はOutputとContextを重視して集計します。
              </div>
              <div className="memory-overview-insights">
                <span><small>Input／Output差</small><b>{selected.input === null || selected.output === null ? '—' : `${Math.round((selected.input - selected.output) * 100)}pt`}</b></span>
                <span><small>直近セッション</small><b>{selectedRecent ? `回答 ${selectedRecent.answerCount}回` : 'まだありません'}</b></span>
                <span><small>苦手タグ</small><b>{selectedWeakTags.join('・') || '—'}</b></span>
              </div>
              <button type="button" className="btn btn-primary memory-start-button" onClick={() => navigate({ name: 'studySetup', setIds: [selected.set.id] })}>このセットで学習</button>
              <button type="button" className="btn btn-ghost memory-start-button" onClick={() => navigate({ name: 'analytics', setIds: [selected.set.id] })}>苦手分析を見る</button>
            </aside>
          )}
        </div>
      )}
      {createSetOpen && <CreateSetDialog onClose={() => setCreateSetOpen(false)} />}
      {conflictsOpen && <MemoryConflictsDialog onClose={() => setConflictsOpen(false)} />}
    </section>
  );
}
