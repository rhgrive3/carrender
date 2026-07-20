import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useApp } from '../../state/AppContext';
import type { Material } from '../../types';
import { computeMaterialForecast, todayQuotaFor } from '../../lib/analytics';
import { today } from '../../lib/date';
import { EmptyState } from '../ui/bits';
import { MaterialDetail } from './MaterialDetail';
import { MaterialShelfCard } from './MaterialShelfCard';
import { Sheet } from '../ui/Sheet';

const FORECAST_ORDER = { risk: 0, behind: 1, onTrack: 2, ahead: 3 } as const;
type MaterialSort = 'urgency' | 'deadline' | 'progress' | 'name';

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export function MaterialShelf({ materials: source, activeTimerMaterialId, onEdit, onStart, onRestore }: {
  materials: Material[];
  activeTimerMaterialId: string | null;
  onEdit: (material: Material) => void;
  onStart: (material: Material) => void;
  onRestore: (material: Material) => void;
}) {
  const { state } = useApp();
  const t = today();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [sort, setSort] = useState<MaterialSort>('urgency');
  const wideDetail = useMediaQuery('(min-width: 860px)');
  const subjectById = useMemo(() => new Map(state.subjects.map((subject) => [subject.id, subject])), [state.subjects]);
  const forecastById = useMemo(() => new Map(source.map((material) => [material.id, computeMaterialForecast(state, material.id, t)])), [source, state, t]);
  const subjectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const material of source) counts.set(material.subjectId, (counts.get(material.subjectId) ?? 0) + 1);
    return counts;
  }, [source]);
  const materials = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja');
    const filtered = source.filter((material) => {
      if (subjectFilter !== 'all' && material.subjectId !== subjectFilter) return false;
      if (!needle) return true;
      return `${material.name} ${subjectById.get(material.subjectId)?.name ?? ''}`.toLocaleLowerCase('ja').includes(needle);
    });
    return [...filtered].sort((left, right) => {
      if (sort === 'deadline') return left.targetDate.localeCompare(right.targetDate) || left.name.localeCompare(right.name, 'ja');
      if (sort === 'progress') return (left.doneAmount / Math.max(1, left.totalAmount)) - (right.doneAmount / Math.max(1, right.totalAmount)) || left.name.localeCompare(right.name, 'ja');
      if (sort === 'name') return left.name.localeCompare(right.name, 'ja');
      const leftStatus = forecastById.get(left.id)?.status ?? 'onTrack';
      const rightStatus = forecastById.get(right.id)?.status ?? 'onTrack';
      return FORECAST_ORDER[leftStatus] - FORECAST_ORDER[rightStatus] || left.targetDate.localeCompare(right.targetDate) || left.name.localeCompare(right.name, 'ja');
    });
  }, [forecastById, query, sort, source, subjectById, subjectFilter]);
  const groups = useMemo(() => {
    const known = state.subjects.map((subject) => ({ ...subject, materials: materials.filter((material) => material.subjectId === subject.id) })).filter((group) => group.materials.length > 0);
    const knownIds = new Set(state.subjects.map((subject) => subject.id));
    const unknown = materials.filter((material) => !knownIds.has(material.subjectId));
    return unknown.length > 0 ? [...known, { id: 'unknown', name: 'その他', color: 'var(--accent)', importance: 3, weakness: 3, materials: unknown }] : known;
  }, [materials, state.subjects]);
  const selected = materials.find((material) => material.id === selectedId) ?? materials[0] ?? null;
  const mobileSelected = materials.find((material) => material.id === selectedId) ?? null;
  const attentionCount = source.filter((material) => ['risk', 'behind'].includes(forecastById.get(material.id)?.status ?? '')).length;
  const todayTarget = Math.round(source.reduce((sum, material) => sum + (material.archived ? 0 : todayQuotaFor(state, material.id, t)), 0));
  const clearFilters = () => { setQuery(''); setSubjectFilter('all'); };

  if (source.length === 0) return null;
  return (
    <>
      {!source[0]?.archived && (
        <div className="materials-overview" aria-label="使用中教材の概要">
          <div><strong>{source.length}</strong><span>使用中の教材</span></div>
          <div className={attentionCount > 0 ? 'warning' : ''}><strong>{attentionCount}</strong><span>要確認</span></div>
          <div><strong>{todayTarget}</strong><span>今日の目安・合計</span></div>
        </div>
      )}
      <div className="materials-controls">
        <div className="materials-search-sort">
          <label className="materials-search"><Search size={18} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="教材名・科目で検索" aria-label="教材を検索" /></label>
          <select className="materials-sort" value={sort} onChange={(event) => setSort(event.target.value as MaterialSort)} aria-label="教材の並び順"><option value="urgency">要確認順</option><option value="deadline">期限が近い順</option><option value="progress">進捗が少ない順</option><option value="name">教材名順</option></select>
        </div>
        <div className="material-subject-filters" aria-label="科目で絞り込む">
          <button type="button" className={`material-filter-chip ${subjectFilter === 'all' ? 'active' : ''}`} aria-pressed={subjectFilter === 'all'} onClick={() => setSubjectFilter('all')}>すべて <span>{source.length}</span></button>
          {state.subjects.filter((subject) => (subjectCounts.get(subject.id) ?? 0) > 0).map((subject) => <button key={subject.id} type="button" className={`material-filter-chip ${subjectFilter === subject.id ? 'active' : ''}`} aria-pressed={subjectFilter === subject.id} onClick={() => setSubjectFilter(subject.id)}><i className="subject-dot" style={{ background: subject.color }} aria-hidden="true" />{subject.name} <span>{subjectCounts.get(subject.id)}</span></button>)}
        </div>
      </div>
      {materials.length === 0 ? (
        <div className="materials-empty-filter"><EmptyState icon="🔎" title="条件に合う教材がありません">検索語や科目の絞り込みを変えてください。<button type="button" className="btn btn-secondary mt-12" onClick={clearFilters}>絞り込みを解除</button></EmptyState></div>
      ) : (
        <div className="materials-master-detail">
          <div className="material-list-panel material-shelf" aria-label="教材一覧">
            {groups.map((group) => <section className="material-subject-group" key={group.id} aria-labelledby={`material-group-${group.id}`}><div className="material-subject-heading"><i className="subject-dot" style={{ background: group.color }} aria-hidden="true" /><h2 id={`material-group-${group.id}`}>{group.name}</h2><small>{group.materials.length}冊</small></div><div className="material-subject-grid">{group.materials.map((material) => {
              const forecast = forecastById.get(material.id);
              const status = material.doneAmount >= material.totalAmount ? '完了' : forecast?.status === 'risk' ? '危険' : forecast?.status === 'behind' ? '遅れ' : forecast?.status === 'ahead' ? '余裕' : '順調';
              const statusClass = forecast?.status === 'risk' ? 'critical' : forecast?.status === 'behind' ? 'warning' : '';
              return <MaterialShelfCard key={material.id} material={material} subject={subjectById.get(material.subjectId)} selected={(wideDetail ? selected?.id : selectedId) === material.id} status={status} statusClass={statusClass} activeTimer={activeTimerMaterialId === material.id} onSelect={() => setSelectedId(material.id)} onStart={() => onStart(material)} onEdit={() => onEdit(material)} onRestore={() => onRestore(material)} />;
            })}</div></section>)}
          </div>
          {wideDetail && selected && <MaterialDetail material={selected} onEdit={() => onEdit(selected)} onStart={() => onStart(selected)} timerActive={activeTimerMaterialId === selected.id} />}
        </div>
      )}
      {!wideDetail && (
        <Sheet open={Boolean(mobileSelected)} onClose={() => setSelectedId(null)} title="教材の詳細" className="material-detail-sheet">
          {mobileSelected && (
            <MaterialDetail
              material={mobileSelected}
              onEdit={() => {
                setSelectedId(null);
                onEdit(mobileSelected);
              }}
              onStart={() => {
                setSelectedId(null);
                onStart(mobileSelected);
              }}
              timerActive={activeTimerMaterialId === mobileSelected.id}
            />
          )}
        </Sheet>
      )}
    </>
  );
}
