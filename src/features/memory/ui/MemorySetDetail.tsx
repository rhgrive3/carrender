import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Download, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { MemorySetBundle, MemoryStat } from '../domain/types';
import { normalizeSearchText } from '../domain/normalization';
import { generateLearningTargets, summarizeLearningTargetStats } from '../domain/selectors';
import { deleteMemorySet, updateMemorySet, verifyMemoryItem } from '../application/content';
import { useToast } from '../../../components/ui/Toast';
import { useMemory } from './MemoryContext';
import { MemoryDialog } from './MemoryDialog';

export function MemorySetDetail({ setId }: { setId: string }) {
  const { repository, navigate, refresh, requestSync } = useMemory();
  const toast = useToast();
  const [bundle, setBundle] = useState<MemorySetBundle | null>(null);
  const [stats, setStats] = useState<MemoryStat[]>([]);
  const [query, setQuery] = useState('');
  const [editingSet, setEditingSet] = useState(false);
  const [setName, setSetName] = useState('');
  const [setDescription, setSetDescription] = useState('');
  const [loadError, setLoadError] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);
  const [actionBusy, setActionBusy] = useState(false);
  const actionInFlightRef = useRef(false);
  const actionTokenRef = useRef(0);
  const activeSetIdRef = useRef(setId);

  const reload = async (shouldApply: () => boolean = () => true) => {
    if (!repository) return;
    const next = await repository.loadSetBundle([setId]);
    if (!next.sets[0]) throw new Error('暗記セットが見つかりません');
    const nextStats = await repository.getStats(new Set(next.senses.map((sense) => sense.id)));
    if (!shouldApply()) return;
    setBundle(next);
    setStats(nextStats);
  };

  const refreshAfterMutation = async (label: string, isCurrent: () => boolean) => {
    const [detailResult, contextResult] = await Promise.allSettled([reload(isCurrent), refresh()]);
    if (detailResult.status === 'rejected') {
      console.error(`${label}後のセット再読込に失敗しました`, detailResult.reason);
      if (isCurrent()) setReloadKey((value) => value + 1);
    }
    if (contextResult.status === 'rejected') {
      console.error(`${label}後の暗記一覧更新に失敗しました`, contextResult.reason);
    }
  };

  const requestSyncSafely = () => {
    void requestSync(true).catch(() => undefined);
  };

  useLayoutEffect(() => {
    activeSetIdRef.current = setId;
    actionTokenRef.current += 1;
    actionInFlightRef.current = false;
    setActionBusy(false);
    setBundle(null);
    setStats([]);
    setLoadError(undefined);
    setEditingSet(false);
  }, [setId]);

  useLayoutEffect(() => {
    if (!repository) {
      setBundle(null);
      setStats([]);
      return;
    }
    let cancelled = false;
    setBundle(null);
    setStats([]);
    setLoadError(undefined);
    void (async () => {
      const next = await repository.loadSetBundle([setId]);
      if (!next.sets[0]) throw new Error('暗記セットが見つかりません');
      const nextStats = await repository.getStats(new Set(next.senses.map((sense) => sense.id)));
      if (!cancelled) {
        setBundle(next);
        setStats(nextStats);
      }
    })().catch((caught) => {
      if (!cancelled) setLoadError(caught instanceof Error ? caught.message : '暗記セットを読み込めませんでした');
    });
    return () => { cancelled = true; };
  }, [reloadKey, repository, setId]);

  const targets = useMemo(() => bundle ? generateLearningTargets({ content: bundle, setMembers: bundle.setMembers, selectedSetIds: [setId], direction: 'output', includeUnverifiedAi: false })
    .filter((target) => !target.exerciseId && target.mode === 'output') : [], [bundle, setId]);
  const summary = useMemo(() => summarizeLearningTargetStats(targets, stats), [stats, targets]);

  const rows = useMemo(() => {
    if (!bundle) return [];
    const order = new Map(bundle.setMembers.map((member) => [member.itemId, member.order]));
    return bundle.items.map((item) => {
      const senses = bundle.senses.filter((sense) => sense.itemId === item.id);
      const senseIds = new Set(senses.map((sense) => sense.id));
      const answers = bundle.answers.filter((answer) => senseIds.has(answer.senseId));
      const examples = bundle.examples.filter((example) => senseIds.has(example.senseId));
      const hasUnverified = [item, ...senses, ...answers, ...examples].some((record) => record.verificationStatus === 'unverified_ai');
      const search = normalizeSearchText([item.label, ...senses.map((sense) => sense.promptJa), ...answers.map((answer) => answer.displayForm), ...examples.map((example) => `${example.english} ${example.japanese ?? ''}`)].join(' '));
      return { item, senses, answers, examples, hasUnverified, search, order: order.get(item.id) ?? Number.MAX_SAFE_INTEGER };
    }).sort((left, right) => left.order - right.order);
  }, [bundle]);

  const filtered = normalizeSearchText(query) ? rows.filter((row) => row.search.includes(normalizeSearchText(query))) : rows;
  const set = bundle?.sets[0];

  const runAction = async (operation: (isCurrent: () => boolean) => Promise<void>, fallback: string) => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    const actionSetId = setId;
    const actionToken = ++actionTokenRef.current;
    const isCurrent = () => activeSetIdRef.current === actionSetId && actionTokenRef.current === actionToken;
    setActionBusy(true);
    try {
      await operation(isCurrent);
    } catch (caught) {
      if (isCurrent()) toast(caught instanceof Error ? caught.message : fallback);
    } finally {
      if (isCurrent()) {
        actionInFlightRef.current = false;
        setActionBusy(false);
      }
    }
  };

  const removeFromSet = async (itemId: string) => {
    if (!repository || !window.confirm('このカードをセットから外しますか？')) return;
    const member = bundle?.setMembers.find((value) => value.itemId === itemId);
    if (!member) return;
    await runAction(async (isCurrent) => {
      await repository.saveSetMember({ ...member, deletedAt: new Date().toISOString() });
      await refreshAfterMutation('カード除外', isCurrent);
      requestSyncSafely();
    }, 'カードをセットから外せませんでした');
  };

  const verifyItem = async (itemId: string) => {
    if (!repository || !window.confirm('この内容を確認済みにして通常学習へ含めますか？')) return;
    await runAction(async (isCurrent) => {
      const count = await verifyMemoryItem(repository, itemId);
      await refreshAfterMutation('確認済み化', isCurrent);
      requestSyncSafely();
      if (isCurrent()) toast(`${count}件を確認済みにしました`);
    }, '内容を確認済みにできませんでした');
  };

  const beginSetEdit = () => {
    if (!set) return;
    setSetName(set.name);
    setSetDescription(set.description ?? '');
    setEditingSet(true);
  };

  const saveSetEdit = async () => {
    if (!repository || !set || !setName.trim()) return;
    await runAction(async (isCurrent) => {
      await updateMemorySet(repository, set, { name: setName, description: setDescription, tags: set.tags });
      if (isCurrent()) setEditingSet(false);
      await refreshAfterMutation('セット更新', isCurrent);
      requestSyncSafely();
    }, '暗記セットを更新できませんでした');
  };

  const removeSet = async () => {
    if (!repository || !set || !window.confirm('このセットを削除しますか？カード本体と成績は残ります。')) return;
    await runAction(async (isCurrent) => {
      await deleteMemorySet(repository, set);
      try {
        await refresh();
      } catch (caught) {
        console.error('暗記セット削除後の一覧更新に失敗しました', caught);
      }
      requestSyncSafely();
      if (isCurrent()) navigate({ name: 'home' });
    }, '暗記セットを削除できませんでした');
  };

  if (loadError) {
    return (
      <div className="card memory-error" role="alert">
        <h2>暗記セットを開けませんでした</h2>
        <p>{loadError}</p>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={() => setReloadKey((value) => value + 1)}>再読み込み</button>
          <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'home' })}>暗記ホームへ戻る</button>
        </div>
      </div>
    );
  }
  if (!bundle || !set) return <div className="card memory-loading" role="status" aria-live="polite">セットを読み込んでいます…</div>;

  return (
    <section className="memory-detail memory-simple-detail">
      <div className="memory-page-header">
        <button type="button" className="icon-btn" aria-label="暗記ホームへ戻る" onClick={() => navigate({ name: 'home' })}><ArrowLeft size={21} /></button>
        <div><h2>{set.name}</h2><p>{bundle.senses.length}カード</p></div>
        <div className="memory-page-actions">
          <button type="button" className="icon-btn" aria-label="セットを編集" disabled={actionBusy} onClick={beginSetEdit}><Pencil size={19} /></button>
          <button type="button" className="icon-btn" aria-label="セットを削除" disabled={actionBusy} onClick={() => void removeSet()}><Trash2 size={19} /></button>
          <button type="button" className="icon-btn" aria-label="取込・出力" disabled={actionBusy} onClick={() => navigate({ name: 'import', setId })}><Download size={20} /></button>
          <button type="button" className="btn btn-primary" disabled={actionBusy} onClick={() => navigate({ name: 'editor', setId })}><Plus size={18} />追加</button>
        </div>
      </div>

      <div className="memory-simple-summary card">
        <span><b>{bundle.senses.length}</b><small>カード</small></span>
        <span><b>{summary.weakSenseCount}</b><small>苦手</small></span>
        <span><b>{summary.unattemptedSenseCount}</b><small>未学習</small></span>
        <button type="button" className="btn btn-primary" disabled={bundle.senses.length === 0 || actionBusy} onClick={() => navigate({ name: 'studySetup', setIds: [setId] })}>学習を始める</button>
      </div>

      <label className="memory-search memory-search-wide"><Search size={17} /><span className="sr-only">カードを検索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="日本語・英語を検索" /></label>

      <div className="memory-simple-card-list" role="list" aria-busy={actionBusy}>
        {filtered.map(({ item, senses, answers, examples, hasUnverified }) => (
          <article className="card memory-simple-card-row" key={item.id} role="listitem">
            <button type="button" className="memory-simple-card-main" disabled={actionBusy} onClick={() => navigate({ name: 'editor', setId, itemId: item.id })}>
              <span className="memory-content-meaning">{senses.map((sense) => sense.promptJa).join('／')}</span>
              <b>{answers.map((answer) => answer.displayForm).join('／')}</b>
              {examples[0] && <small>{examples[0].english}</small>}
            </button>
            {hasUnverified && <button type="button" className="icon-btn memory-verify" aria-label="AI追加内容を確認済みにする" disabled={actionBusy} onClick={() => void verifyItem(item.id)}><CheckCircle2 size={18} /></button>}
            <button type="button" className="icon-btn memory-remove" aria-label="セットから外す" disabled={actionBusy} onClick={() => void removeFromSet(item.id)}><Trash2 size={18} /></button>
          </article>
        ))}
      </div>

      {filtered.length === 0 && <div className="card empty-state"><div className="empty-title">該当するカードがありません</div></div>}

      {editingSet && <MemoryDialog title="暗記セットを編集" onClose={() => { if (!actionBusy) setEditingSet(false); }} footer={<button type="button" className="btn btn-primary" disabled={actionBusy || !setName.trim()} onClick={() => void saveSetEdit()}>{actionBusy ? '保存中…' : '変更を保存'}</button>}><div className="field"><label htmlFor="memory-edit-set-name">セット名</label><input id="memory-edit-set-name" autoFocus value={setName} onChange={(event) => setSetName(event.target.value)} /></div><div className="field"><label htmlFor="memory-edit-set-description">説明</label><textarea id="memory-edit-set-description" value={setDescription} onChange={(event) => setSetDescription(event.target.value)} /></div></MemoryDialog>}
    </section>
  );
}
