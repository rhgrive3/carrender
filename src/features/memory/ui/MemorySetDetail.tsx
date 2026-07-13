import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, CheckCircle2, Download, Flag, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { MemorySetBundle, MemoryStat } from '../domain/types';
import { normalizeSearchText } from '../domain/normalization';
import { aggregateMastery } from '../domain/weakness';
import { generateLearningTargets, summarizeLearningTargetStats } from '../domain/selectors';
import { deleteMemorySet, updateMemorySet, verifyMemoryItem } from '../application/content';
import { useToast } from '../../../components/ui/Toast';
import { useMemory } from './MemoryContext';
import { MemoryDialog } from './MemoryDialog';

function formatMastery(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

export function MemorySetDetail({ setId }: { setId: string }) {
  const { repository, navigate, refresh, requestSync } = useMemory();
  const toast = useToast();
  const [bundle, setBundle] = useState<MemorySetBundle | null>(null);
  const [stats, setStats] = useState<MemoryStat[]>([]);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(100);
  const [editingSet, setEditingSet] = useState(false);
  const [setName, setSetName] = useState('');
  const [setDescription, setSetDescription] = useState('');
  const [setTags, setSetTags] = useState('');

  const reload = async () => {
    if (!repository) return;
    const next = await repository.loadSetBundle([setId]);
    const targetIds = new Set([
      ...next.senses.map((sense) => sense.id),
      ...next.answers.map((answer) => answer.id),
      ...next.exercises.map((exercise) => exercise.id),
    ]);
    setBundle(next);
    setStats(await repository.getStats(targetIds));
  };

  useEffect(() => {
    void reload();
    // reload is intentionally scoped to the selected set/repository.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository, setId]);

  const targets = useMemo(() => bundle ? generateLearningTargets({
    content: bundle,
    setMembers: bundle.setMembers,
    selectedSetIds: [setId],
    direction: 'mix',
    includeUnverifiedAi: true,
  }) : [], [bundle, setId]);
  const setSummary = useMemo(
    () => summarizeLearningTargetStats(targets, stats),
    [stats, targets],
  );

  const rows = useMemo(() => {
    if (!bundle) return [];
    const sensesByItem = new Map<string, typeof bundle.senses>();
    for (const sense of bundle.senses) {
      const values = sensesByItem.get(sense.itemId) ?? [];
      values.push(sense);
      sensesByItem.set(sense.itemId, values);
    }
    const answersBySense = new Map<string, typeof bundle.answers>();
    for (const answer of bundle.answers) {
      const values = answersBySense.get(answer.senseId) ?? [];
      values.push(answer);
      answersBySense.set(answer.senseId, values);
    }
    const examplesBySense = new Map<string, typeof bundle.examples>();
    for (const example of bundle.examples) {
      const values = examplesBySense.get(example.senseId) ?? [];
      values.push(example);
      examplesBySense.set(example.senseId, values);
    }
    const order = new Map(bundle.setMembers.map((member) => [member.itemId, member.order]));
    return bundle.items.map((item) => {
      const senses = sensesByItem.get(item.id) ?? [];
      const senseIds = new Set(senses.map((sense) => sense.id));
      const answers = senses.flatMap((sense) => answersBySense.get(sense.id) ?? []);
      const examples = senses.flatMap((sense) => examplesBySense.get(sense.id) ?? []);
      const exercises = bundle.exercises.filter((exercise) => senseIds.has(exercise.senseId));
      const search = normalizeSearchText([
        item.label,
        ...item.tags,
        ...senses.flatMap((sense) => [sense.promptJa, sense.meaningJa, ...sense.tags]),
        ...answers.flatMap((answer) => [answer.displayForm, answer.citationForm, ...answer.acceptedVariants, ...answer.orthographicVariants]),
        ...examples.flatMap((example) => [example.english, example.japanese ?? '']),
      ].join(' '));
      const hasUnverified = [item, ...senses, ...answers, ...examples, ...exercises]
        .some((record) => record.verificationStatus === 'unverified_ai');
      const summary = summarizeLearningTargetStats(
        targets.filter((target) => target.itemId === item.id),
        stats,
      );
      const answerMastery = answers.map((answer) => ({
        answer,
        mastery: aggregateMastery(stats.filter((stat) =>
          stat.targetType === 'answer' && stat.targetId === answer.id,
        )),
      }));
      return { item, senses, answers, answerMastery, search, hasUnverified, summary, order: order.get(item.id) ?? Number.MAX_SAFE_INTEGER };
    }).sort((left, right) => left.order - right.order);
  }, [bundle, stats, targets]);

  const normalizedQuery = normalizeSearchText(query);
  const filtered = normalizedQuery ? rows.filter((row) => row.search.includes(normalizedQuery)) : rows;
  const set = bundle?.sets[0];

  const removeFromSet = async (itemId: string) => {
    if (!repository || !window.confirm('このセットから外しますか？項目本体と成績は削除されません。')) return;
    const member = bundle?.setMembers.find((value) => value.itemId === itemId);
    if (!member) return;
    await repository.saveSetMember({ ...member, deletedAt: new Date().toISOString() });
    await Promise.all([reload(), refresh()]);
    void requestSync(true);
  };

  const verifyItem = async (itemId: string) => {
    if (!repository || !window.confirm('AI追加内容を確認済みにして通常学習へ含めますか？')) return;
    const count = await verifyMemoryItem(repository, itemId);
    await Promise.all([reload(), refresh()]);
    void requestSync(true);
    toast(`${count}件を確認済みにしました`);
  };

  const toggleManualWeak = async (senseId: string, current: boolean) => {
    if (!repository) return;
    try {
      await repository.setManualWeak('sense', senseId, 'output', !current);
      await Promise.all([reload(), refresh()]);
      void requestSync(true);
      toast(current ? 'Outputの苦手マークを外しました' : 'Outputへ苦手マークを付けました');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '苦手マークを更新できませんでした');
    }
  };

  const beginSetEdit = () => {
    if (!set) return;
    setSetName(set.name); setSetDescription(set.description ?? ''); setSetTags(set.tags.join(', ')); setEditingSet(true);
  };

  const saveSetEdit = async () => {
    if (!repository || !set) return;
    try {
      await updateMemorySet(repository, set, {
        name: setName,
        description: setDescription,
        tags: setTags.split(/[,、]/u),
      });
      setEditingSet(false);
      await Promise.all([reload(), refresh()]);
      void requestSync(true);
      toast('セットを更新しました');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'セットを更新できませんでした');
    }
  };

  const removeSet = async () => {
    if (!repository || !set || !window.confirm('このセットを削除しますか？項目本体と成績は削除されません。')) return;
    await deleteMemorySet(repository, set);
    await refresh();
    void requestSync(true);
    toast('セットを削除しました');
    navigate({ name: 'home' });
  };

  if (!bundle || !set) return <div className="card memory-loading">セットを読み込んでいます…</div>;

  return (
    <section className="memory-detail">
      <div className="memory-page-header">
        <button type="button" className="icon-btn" aria-label="暗記ホームへ戻る" onClick={() => navigate({ name: 'home' })}><ArrowLeft size={21} /></button>
        <div><h2>{set.name}</h2><p>{bundle.senses.length}項目・複数表現 {bundle.answers.length}件</p></div>
        <div className="memory-page-actions">
          <button type="button" className="icon-btn" aria-label="セット名と説明を編集" onClick={beginSetEdit}><Pencil size={19} /></button>
          <button type="button" className="icon-btn" aria-label="セットを削除" onClick={() => void removeSet()}><Trash2 size={19} /></button>
          <button type="button" className="icon-btn" aria-label="取込・出力" onClick={() => navigate({ name: 'import', setId })}><Download size={20} /></button>
          <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'editor', setId })}><Plus size={18} />追加</button>
        </div>
      </div>

      <div className="memory-detail-actions">
        <label className="memory-search memory-search-wide">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">カードを検索</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="日本語・英語・タグ・例文を検索" />
        </label>
        <button type="button" className="btn btn-ghost" onClick={() => navigate({ name: 'analytics', setIds: [setId] })}><BarChart3 size={18} />分析</button>
        <button type="button" className="btn btn-primary" disabled={bundle.senses.length === 0} onClick={() => navigate({ name: 'studySetup', setIds: [setId] })}>学習を始める</button>
      </div>

      <div className="memory-mastery-grid" aria-label="セットのモード別習得率">
        <span><small>Input</small><b>{formatMastery(setSummary.mastery.byMode.input.mastery)}</b></span>
        <span><small>Output</small><b>{formatMastery(setSummary.mastery.byMode.output.mastery)}</b></span>
        <span><small>Context</small><b>{formatMastery(setSummary.mastery.byMode.context.mastery)}</b></span>
        <span><small>Composition</small><b>{formatMastery(setSummary.mastery.byMode.composition.mastery)}</b></span>
        <span><small>苦手</small><b>{setSummary.weakSenseCount}</b></span>
        <span><small>未出題</small><b>{setSummary.unattemptedSenseCount}</b></span>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty-state"><span className="empty-icon" aria-hidden="true">📝</span><div className="empty-title">該当する項目がありません</div></div>
      ) : (
        <div className="memory-card-list" role="list">
          {filtered.slice(0, visibleCount).map(({ item, senses, answers, answerMastery, hasUnverified, summary }) => (
            <article className="card memory-content-row" key={item.id} role="listitem">
              <button type="button" className="memory-content-main" onClick={() => navigate({ name: 'editor', setId, itemId: item.id })}>
                <span className="memory-content-label">{item.label}</span>
                <span className="memory-content-meaning">{senses.map((sense) => sense.promptJa).join('／')}</span>
                <span className="memory-content-answers">{answers.map((answer) => answer.displayForm).join('・')}</span>
                <span className="memory-content-meta">
                  Input {formatMastery(summary.mastery.byMode.input.mastery)}
                  {' ・ '}Output {formatMastery(summary.mastery.byMode.output.mastery)}
                  {' ・ '}Context {formatMastery(summary.mastery.byMode.context.mastery)}
                  {' ・ '}Composition {formatMastery(summary.mastery.byMode.composition.mastery)}
                  {hasUnverified && <i className="status-badge status-warn">AI未確認あり</i>}
                </span>
                <span className="memory-content-meta" style={{ flexWrap: 'wrap' }} aria-label="Answer別成績">
                  {answerMastery.map(({ answer, mastery }) => (
                    <span key={answer.id}>
                      {answer.displayForm}：Output {formatMastery(mastery.byMode.output.mastery)}／Context {formatMastery(mastery.byMode.context.mastery)}／Composition {formatMastery(mastery.byMode.composition.mastery)}
                    </span>
                  ))}
                </span>
              </button>
              <div className="memory-manual-weak-list" aria-label={`${item.label}のOutput苦手マーク`}>
                {senses.map((sense) => {
                  const marked = stats.some((stat) => stat.targetType === 'sense'
                    && stat.targetId === sense.id
                    && stat.mode === 'output'
                    && stat.manualWeak);
                  return (
                    <button
                      type="button"
                      key={sense.id}
                      className={marked ? 'active' : ''}
                      aria-pressed={marked}
                      aria-label={`${sense.promptJa}をOutputの苦手${marked ? 'から外す' : 'にする'}`}
                      onClick={() => void toggleManualWeak(sense.id, marked)}
                    >
                      <Flag size={15} fill={marked ? 'currentColor' : 'none'} aria-hidden="true" />
                      <span>{sense.promptJa}</span>
                    </button>
                  );
                })}
              </div>
              {hasUnverified && <button type="button" className="icon-btn memory-verify" aria-label={`${item.label}のAI追加内容を確認済みにする`} onClick={() => void verifyItem(item.id)}><CheckCircle2 size={18} /></button>}
              <button type="button" className="icon-btn memory-remove" aria-label={`${item.label}をセットから外す`} onClick={() => void removeFromSet(item.id)}><Trash2 size={18} /></button>
            </article>
          ))}
        </div>
      )}
      {filtered.length > visibleCount && <button type="button" className="btn btn-ghost memory-load-more" onClick={() => setVisibleCount((value) => value + 100)}>さらに100件表示</button>}
      {editingSet && (
        <MemoryDialog title="暗記セットを編集" onClose={() => setEditingSet(false)} footer={<button type="button" className="btn btn-primary" onClick={() => void saveSetEdit()}>変更を保存</button>}>
          <div className="field"><label htmlFor="memory-edit-set-name">セット名</label><input id="memory-edit-set-name" autoFocus value={setName} onChange={(event) => setSetName(event.target.value)} /></div>
          <div className="field"><label htmlFor="memory-edit-set-description">説明</label><textarea id="memory-edit-set-description" value={setDescription} onChange={(event) => setSetDescription(event.target.value)} /></div>
          <div className="field"><label htmlFor="memory-edit-set-tags">タグ</label><input id="memory-edit-set-tags" value={setTags} onChange={(event) => setSetTags(event.target.value)} placeholder="カンマ区切り" /></div>
        </MemoryDialog>
      )}
    </section>
  );
}
