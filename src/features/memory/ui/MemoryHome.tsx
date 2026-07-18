import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Download, Play, Plus, RefreshCw, Search } from 'lucide-react';
import type { MemoryLocalSnapshot } from '../infrastructure/repositories';
import type { MemorySet } from '../domain/types';
import { generateLearningTargets, summarizeLearningTargetStats } from '../domain/selectors';
import { createMemorySet } from '../application/content';
import { createSimpleStudySession } from '../application/simpleSession';
import { useToast } from '../../../components/ui/Toast';
import { useMemory } from './MemoryContext';
import { MemoryDialog } from './MemoryDialog';
import { MemoryConflictsDialog } from './MemoryConflictsDialog';

interface SetSummary { set: MemorySet; cards: number; eligible: number; weak: number; newCount: number }

function summariesOf(snapshot: MemoryLocalSnapshot): SetSummary[] {
  return snapshot.sets.map((set) => {
    const itemIds = new Set(snapshot.setMembers.filter((member) => member.setId === set.id).map((member) => member.itemId));
    const cards = snapshot.senses.filter((sense) => itemIds.has(sense.itemId)).length;
    const targets = generateLearningTargets({ content: snapshot, setMembers: snapshot.setMembers, selectedSetIds: [set.id], direction: 'output', includeUnverifiedAi: false })
      .filter((target) => !target.exerciseId && target.mode === 'output');
    const summary = summarizeLearningTargetStats(targets, snapshot.stats);
    return { set, cards, eligible: targets.length, weak: summary.weakSenseCount, newCount: summary.unattemptedSenseCount };
  });
}

function CreateSetDialog({ onClose }: { onClose: () => void }) {
  const { repository, refresh, requestSync } = useMemory();
  const toast = useToast();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!repository || saving || !name.trim()) return;
    setSaving(true);
    try {
      await createMemorySet(repository, { name });
      await refresh();
      void requestSync(true);
      onClose();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '暗記セットを作成できませんでした');
    } finally {
      setSaving(false);
    }
  };
  return <MemoryDialog title="暗記セットを追加" onClose={() => { if (!saving) onClose(); }} footer={<button type="button" className="btn btn-primary" disabled={saving || !name.trim()} onClick={() => void save()}>{saving ? '作成中…' : 'セットを作る'}</button>}><div className="field"><label htmlFor="memory-set-name">セット名</label><input id="memory-set-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例：LEAP 1〜300" /></div></MemoryDialog>;
}

export function MemoryHome() {
  const { repository, ready, error, activeSession, syncStatus, syncError, pendingCount, conflictCount, navigate, refresh, requestSync } = useMemory();
  const toast = useToast();
  const [snapshot, setSnapshot] = useState<MemoryLocalSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<string>();
  const [snapshotReloadKey, setSnapshotReloadKey] = useState(0);
  const [query, setQuery] = useState('');
  const [createSetOpen, setCreateSetOpen] = useState(false);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [startingSetId, setStartingSetId] = useState<string>();

  useEffect(() => {
    if (!repository || !ready) return;
    let cancelled = false;
    setSnapshotError(undefined);
    void repository.loadSnapshot().then((value) => {
      if (!cancelled) setSnapshot(value);
    }).catch((caught) => {
      if (!cancelled) setSnapshotError(caught instanceof Error ? caught.message : '暗記データを読み込めませんでした');
    });
    return () => { cancelled = true; };
  }, [pendingCount, ready, repository, snapshotReloadKey]);

  const summaries = useMemo(() => snapshot ? summariesOf(snapshot) : [], [snapshot]);
  const normalized = query.normalize('NFKC').trim().toLocaleLowerCase('ja-JP');
  const filtered = summaries.filter(({ set }) => !normalized || set.name.normalize('NFKC').toLocaleLowerCase('ja-JP').includes(normalized));

  const start = async (summary: SetSummary) => {
    if (!repository || startingSetId || summary.eligible === 0) return;
    setStartingSetId(summary.set.id);
    try {
      const created = await createSimpleStudySession({
        repository,
        selectedSetIds: [summary.set.id],
        config: { questionCount: { type: 'weak', count: 10 }, direction: 'output', includeUnverifiedAi: false, preferredExerciseType: 'flashcard' },
      });
      await refresh();
      navigate({ name: 'study', sessionId: created.session.id });
    } catch (caught) { toast(caught instanceof Error ? caught.message : '学習を開始できませんでした'); }
    finally { setStartingSetId(undefined); }
  };

  if (!ready) return <div className="card memory-loading" role="status" aria-live="polite">暗記データを開いています…</div>;
  if (error) return <div className="card memory-error" role="alert">{error}</div>;
  if (!snapshot && snapshotError) {
    return (
      <div className="card memory-error" role="alert">
        <h2>暗記データを開けませんでした</h2>
        <p>{snapshotError}</p>
        <button type="button" className="btn btn-primary" onClick={() => setSnapshotReloadKey((value) => value + 1)}>再読み込み</button>
      </div>
    );
  }
  if (!snapshot) return <div className="card memory-loading" role="status" aria-live="polite">暗記データを読み込んでいます…</div>;

  return (
    <section className="memory-home memory-simple-home">
      <div className="memory-toolbar">
        <div><h2>暗記カード</h2><p>セットを選んで、10問ずつ覚える</p></div>
        <div className="memory-toolbar-actions">
          <button type="button" className="btn btn-ghost" onClick={() => navigate({ name: 'import' })}><Download size={18} />取込・出力</button>
          {summaries.length > 0 ? (
            <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'editor', setId: summaries[0].set.id })}><Plus size={18} />カード追加</button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => setCreateSetOpen(true)}><Plus size={18} />セット追加</button>
          )}
        </div>
      </div>

      {snapshotError && <div className="card memory-error" role="alert"><span>{snapshotError}</span><button type="button" className="memory-inline-button" onClick={() => setSnapshotReloadKey((value) => value + 1)}>再読み込み</button></div>}

      <div className="memory-sync-line" aria-live="polite">
        <span className={`memory-sync-dot ${syncStatus}`} aria-hidden="true" />
        {syncStatus === 'offline' ? 'オフライン・端末へ保存済み' : syncStatus === 'syncing' ? '同期中' : syncStatus === 'conflict' ? '差分確認が必要' : syncStatus === 'error' ? '同期失敗・端末へは保存済み' : '端末へ保存済み'}
        {pendingCount > 0 && `・同期待ち ${pendingCount}件`}
        {syncStatus === 'error' && syncError && <span className="memory-sync-error">・{syncError}</span>}
        {conflictCount > 0 && <button type="button" className="memory-inline-button" onClick={() => setConflictsOpen(true)}>競合</button>}
        <button type="button" className="memory-inline-button" onClick={() => void requestSync(true)} aria-label="暗記データを同期"><RefreshCw size={15} /></button>
      </div>

      {activeSession && <button type="button" className="memory-simple-resume card" onClick={() => navigate({ name: 'study', sessionId: activeSession.id })}><ArrowRight size={22} /><span><b>前回の続き</b><small>回答 {activeSession.answerCount}回から再開</small></span></button>}

      {summaries.length === 0 ? (
        <div className="card empty-state memory-empty"><span className="empty-icon">🗂️</span><div className="empty-title">最初の暗記セットを作る</div><p>日本語と英語を登録するだけで始められます。</p><button type="button" className="btn btn-primary" onClick={() => setCreateSetOpen(true)}>セットを作る</button></div>
      ) : (
        <>
          <div className="memory-simple-library-head"><label className="memory-search"><Search size={17} /><span className="sr-only">セットを検索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="セットを検索" /></label><button type="button" className="icon-btn" aria-label="暗記セットを追加" onClick={() => setCreateSetOpen(true)}><Plus size={20} /></button></div>
          {filtered.length === 0 ? (
            <div className="card empty-state memory-empty" role="status">
              <span className="empty-icon" aria-hidden="true">🔎</span>
              <div className="empty-title">一致する暗記セットがありません</div>
              <p>検索語を変えるか、検索を解除してください。</p>
              <button type="button" className="btn btn-secondary" onClick={() => setQuery('')}>検索を解除</button>
            </div>
          ) : (
            <div className="memory-simple-set-cards">
              {filtered.map((summary) => (
                <article className="card memory-simple-set-card" key={summary.set.id}>
                  <div><h3>{summary.set.name}</h3><p>{summary.cards}カード</p></div>
                  <div className="memory-simple-metrics"><span><b>{summary.weak}</b><small>苦手</small></span><span><b>{summary.newCount}</b><small>未学習</small></span></div>
                  <div className="memory-simple-set-actions">
                    <button type="button" className="btn btn-primary" disabled={startingSetId === summary.set.id || summary.eligible === 0} onClick={() => void start(summary)}><Play size={18} fill="currentColor" />{startingSetId === summary.set.id ? '準備中…' : summary.eligible === 0 ? '出題できるカードなし' : '10問始める'}</button>
                    <button type="button" className="btn btn-ghost" onClick={() => navigate({ name: 'set', setId: summary.set.id })}>カードを見る</button>
                    <button type="button" className="btn btn-ghost" onClick={() => navigate({ name: 'studySetup', setIds: [summary.set.id] })}>設定</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
      {createSetOpen && <CreateSetDialog onClose={() => setCreateSetOpen(false)} />}
      {conflictsOpen && <MemoryConflictsDialog onClose={() => setConflictsOpen(false)} />}
    </section>
  );
}
