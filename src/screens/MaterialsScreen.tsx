import { Component, lazy, Suspense, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { useApp } from '../state/AppContext';
import type { Material } from '../types';
import { Segmented, EmptyState } from '../components/ui/bits';
import { useToast } from '../components/ui/Toast';
import { useTimer } from '../components/timer/TimerContext';
import { MaterialFormSheet } from '../components/materials/MaterialFormSheet';
import { MaterialShelf } from '../components/materials/MaterialShelf';

function createMemoryFeatureComponent() {
  return lazy(async () => {
    const module = await import('../features/memory/ui/MemoryFeature');
    return { default: module.MemoryFeature };
  });
}

interface MemoryFeatureBoundaryProps {
  children: ReactNode;
  onRetry: () => void;
  onBack: () => void;
}

interface MemoryFeatureBoundaryState {
  error: Error | null;
}

class MemoryFeatureBoundary extends Component<MemoryFeatureBoundaryProps, MemoryFeatureBoundaryState> {
  state: MemoryFeatureBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): MemoryFeatureBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('暗記機能の読込または描画に失敗しました', error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunkLoadFailure = /Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/iu.test(error.message);
    return (
      <section className="card memory-error" role="alert" aria-labelledby="memory-feature-error-title">
        <h2 id="memory-feature-error-title">暗記機能を開けませんでした</h2>
        <p>教材・計画・記録・タイマーはそのまま使えます。通信が戻ったら暗記機能だけ再読み込みしてください。</p>
        <div className="row mt-12" role="group" aria-label="暗記機能の復旧操作" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={this.props.onRetry}>暗記機能を再読み込み</button>
          <button type="button" className="btn btn-secondary" onClick={this.props.onBack}>教材へ戻る</button>
          {chunkLoadFailure && <button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>アプリを更新</button>}
        </div>
        <details className="mt-12"><summary>エラー詳細</summary><pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>{error.message}</pre></details>
      </section>
    );
  }
}

export type MaterialsPane = 'materials' | 'memory';

export function MaterialsScreen({ pane = 'materials', onPaneChange }: { pane?: MaterialsPane; onPaneChange?: (pane: MaterialsPane) => void }) {
  const { state, execute } = useApp();
  const timer = useTimer();
  const toast = useToast();
  const [editTarget, setEditTarget] = useState<Material | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [archiveTab, setArchiveTab] = useState<'active' | 'archived'>('active');
  const [memoryFeatureVersion, setMemoryFeatureVersion] = useState(0);
  const MemoryFeature = useMemo(createMemoryFeatureComponent, [memoryFeatureVersion]);
  const materials = useMemo(() => state.materials.filter((material) => archiveTab === 'archived' ? material.archived : !material.archived), [archiveTab, state.materials]);

  const startMaterialTimer = (material: Material) => {
    if (timer.target) {
      toast(`「${timer.target.title}」を計測中です。終了してから別の教材を始めてください`);
      return;
    }
    const started = timer.start({ taskId: null, subjectId: material.subjectId, materialId: material.id, title: material.name, rangeLabel: material.name, sourceId: material.id });
    if (!started) {
      toast('別の学習を計測中です。画面下のタイマーから再開できます');
      return;
    }
    toast(`「${material.name}」の計測を開始しました`);
  };

  if (pane === 'memory') {
    return (
      <div className="screen memory-screen">
        <div className="screen-header memory-entry-header"><div><h1 className="screen-title">教材</h1><div className="screen-sub">教材と暗記カードを管理</div></div></div>
        <div className="materials-primary-tabs">
          <Segmented options={[{ value: 'materials', label: '教材' }, { value: 'memory', label: '暗記カード' }]} value={pane} onChange={(value) => onPaneChange?.(value)} ariaLabel="教材画面の切替" />
        </div>
        <MemoryFeatureBoundary
          key={memoryFeatureVersion}
          onRetry={() => setMemoryFeatureVersion((value) => value + 1)}
          onBack={() => onPaneChange?.('materials')}
        >
          <Suspense fallback={<div className="card memory-loading" role="status" aria-live="polite">暗記機能を準備しています…</div>}><MemoryFeature /></Suspense>
        </MemoryFeatureBoundary>
      </div>
    );
  }

  return (
    <div className="screen materials-screen">
      <div className="screen-header">
        <div><h1 className="screen-title">教材</h1><div className="screen-sub">{archiveTab === 'active' ? `使用中 ${materials.length}冊` : `アーカイブ ${materials.length}冊`}</div></div>
        <button className="btn btn-primary materials-add-button" aria-label="教材を追加" onClick={() => setAddOpen(true)}><Plus size={19} strokeWidth={2.4} aria-hidden="true" /><span>教材を追加</span></button>
      </div>
      <div className="materials-primary-tabs">
        <Segmented options={[{ value: 'materials', label: '教材' }, { value: 'memory', label: '暗記カード' }]} value={pane} onChange={(value) => onPaneChange?.(value)} ariaLabel="教材画面の切替" />
      </div>
      <div className="materials-secondary-filter">
        <Segmented options={[{ value: 'active', label: '使用中' }, { value: 'archived', label: 'アーカイブ' }]} value={archiveTab} onChange={setArchiveTab} ariaLabel="教材の状態" />
      </div>
      {materials.length === 0 ? (
        <EmptyState icon="📚" title={archiveTab === 'active' ? '使用中の教材がまだありません' : 'アーカイブは空です'}>{archiveTab === 'active' ? '「教材を追加」から登録すると、試験日までの計画を自動で作ります。' : '使い終わった教材をアーカイブすると、ここからいつでも復元できます。'}</EmptyState>
      ) : (
        <MaterialShelf materials={materials} activeTimerMaterialId={timer.target?.materialId ?? null} onEdit={setEditTarget} onStart={startMaterialTimer} onRestore={(material) => execute({ type: 'UPDATE_MATERIAL', material: { ...material, archived: false } })} />
      )}
      {(addOpen || editTarget) && <MaterialFormSheet material={editTarget} onClose={() => (editTarget ? setEditTarget(null) : setAddOpen(false))} />}
    </div>
  );
}
