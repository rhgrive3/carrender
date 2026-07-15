import { useEffect, useMemo, useState } from 'react';
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

  const reload = async () => {
    if (!repository) return;
    const next = await repository.loadSetBundle([setId]);
    setBundle(next);
    setStats(await repository.getStats(new Set(next.senses.map((sense) => sense.id))));
  };

  useEffect(() => { void reload(); }, [repository, setId]);

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

  const removeFromSet = async (itemId: string) => {
    if (!repository || !window.confirm('このカードをセットから外しますか？')) return;
    const member = bundle?.setMembers.find((value) => value.itemId === itemId);
    if (!member) return;
    await repository.saveSetMember({ ...member, deletedAt: new Date().toISOString() });
    await Promise.all([reload(), refresh()]);
    void requestSync(true);
  };

  const verifyItem = async (itemId: string) => {
    if (!repository || !window.confirm('この内容を確認済みにして通常学習へ含めますか？')) return;
    const count = await verifyMemoryItem(repository, itemId);
    await Promise.all([reload(), refresh()]);
    void requestSync(true);
    toast(`${count}件を確認済みにしました`);
  };

  const beginSetEdit = () => {
    if (!set) return;
    setSetName(set.name);
    setSetDescription(set.description ?? '');
    setEditingSet(true);
  };

  const saveSetEdit = async () => {
    if (!repository || !set) return;
    await updateMemorySet(repository, set, { name: setName, description: setDescription, tags: set.tags });
    setEditingSet(false);
    await Promise.all([reload(), refresh()]);
    void requestSync(true);
  };

  const removeSet = async () => {
    if (!repository || !set || !window.confirm('このセットを削除しますか？カード本体と成績は残ります。')) return;
    await deleteMemorySet(repository, set);
    await refresh();
    void requestSync(true);
    navigate({ name: 'home' });
  };

  if (!bundle || !set) return <div className="card memory-loading">セットを読み込んでいます…</div>;

  return (
    <section className="memory-detail memory-simple-detail">
      <div className="memory-page-header">
        <button type="button" className="icon-btn" aria-label="暗記ホームへ戻る" onClick={() => navigate({ name: 'home' })}><ArrowLeft size={21} /></button>
        <div><h2>{set.name}</h2><p>{bundle.senses.length}カード</p></div>
        <div className="memory-page-actions">
          <button type="button" className="icon-btn" aria-label="セットを編集" onClick={beginSetEdit}><Pencil size={19} /></button>
          <button type="button" className="icon-btn" aria-label="セットを削除" onClick={() => void removeSet()}><Trash2 size={19} /></button>
          <button type="button" className="icon-btn" aria-label="取込・出力" onClick={() => navigate({ name: 'import', setId })}><Download size={20} /></button>
          <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'editor', setId })}><Plus size={18} />追加</button>
        </div>
      </div>

      <div className="memory-simple-summary card">
        <span><b>{bundle.senses.length}</b><small>カード</small></span>
        <span><b>{summary.weakSenseCount}</b><small>苦手</small></span>
        <span><b>{summary.unattemptedSenseCount}</b><small>未学習</small></span>
        <button type="button" className="btn btn-primary" disabled={bundle.senses.length === 0} onClick={() => navigate({ name: 'studySetup', setIds: [setId] })}>学習を始める</button>
      </div>

      <label className="memory-search memory-search-wide"><Search size={17} /><span className="sr-only">カードを検索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="日本語・英語を検索" /></label>

      <div className="memory-simple-card-list" role="list">
        {filtered.map(({ item, senses, answers, examples, hasUnverified }) => (
          <article className="card memory-simple-card-row" key={item.id} role="listitem">
            <button type="button" className="memory-simple-card-main" onClick={() => navigate({ name: 'editor', setId, itemId: item.id })}>
              <span className="memory-content-meaning">{senses.map((sense) => sense.promptJa).join('／')}</span>
              <b>{answers.map((answer) => answer.displayForm).join('／')}</b>
              {examples[0] && <small>{examples[0].english}</small>}
            </button>
            {hasUnverified && <button type="button" className="icon-btn memory-verify" aria-label="AI追加内容を確認済みにする" onClick={() => void verifyItem(item.id)}><CheckCircle2 size={18} /></button>}
            <button type="button" className="icon-btn memory-remove" aria-label="セットから外す" onClick={() => void removeFromSet(item.id)}><Trash2 size={18} /></button>
          </article>
        ))}
      </div>

      {filtered.length === 0 && <div className="card empty-state"><div className="empty-title">該当するカードがありません</div></div>}

      {editingSet && <MemoryDialog title="暗記セットを編集" onClose={() => setEditingSet(false)} footer={<button type="button" className="btn btn-primary" onClick={() => void saveSetEdit()}>変更を保存</button>}><div className="field"><label htmlFor="memory-edit-set-name">セット名</label><input id="memory-edit-set-name" autoFocus value={setName} onChange={(event) => setSetName(event.target.value)} /></div><div className="field"><label htmlFor="memory-edit-set-description">説明</label><textarea id="memory-edit-set-description" value={setDescription} onChange={(event) => setSetDescription(event.target.value)} /></div></MemoryDialog>}
    </section>
  );
}
