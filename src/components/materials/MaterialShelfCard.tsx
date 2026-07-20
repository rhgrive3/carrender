import { ArchiveRestore, Pencil, Timer } from 'lucide-react';
import type { Material } from '../../types';

export function MaterialShelfCard({
  material,
  subject,
  selected,
  status,
  statusClass,
  activeTimer,
  onSelect,
  onStart,
  onEdit,
  onRestore,
}: {
  material: Material;
  subject?: { name: string; color: string };
  selected: boolean;
  status: string;
  statusClass: string;
  activeTimer: boolean;
  onSelect: () => void;
  onStart: () => void;
  onEdit: () => void;
  onRestore: () => void;
}) {
  const rate = material.totalAmount > 0 ? material.doneAmount / material.totalAmount : 0;
  const percent = Math.min(100, Math.max(0, Math.round(rate * 100)));
  const remaining = Math.max(0, material.totalAmount - material.doneAmount);
  const targetLabel = material.targetDate.split('-').join('/');

  return (
    <div className={`material-list-item material-shelf-card ${selected ? 'selected' : ''}`}>
      <button type="button" className="material-list-main" onClick={onSelect} aria-pressed={selected} aria-label={`${material.name}の詳細を表示`}>
        <span className="material-cover-tile" style={{ color: subject?.color ?? 'var(--accent)' }} aria-hidden="true"><strong>{subject?.name.slice(0, 1) ?? '教'}</strong></span>
        <span className="material-list-copy">
          <strong>{material.name}</strong>
          <span className="material-meta-primary">{material.doneAmount} / {material.totalAmount}{material.unit}・残り{remaining}{material.unit}</span>
          <span className="material-meta-secondary">目標 {targetLabel}</span>
          <span className="material-progress-row"><span className="material-list-progress"><i style={{ width: `${percent}%`, background: subject?.color }} /></span><span className="material-progress-percent">{percent}%</span></span>
        </span>
        <span className={`material-card-state ${statusClass}`}>{status}</span>
      </button>
      <div className="material-card-actions">
        {material.archived ? (
          <button type="button" className="material-quick-action primary" aria-label={`${material.name}を復元`} onClick={onRestore}><ArchiveRestore size={17} aria-hidden="true" />復元</button>
        ) : (
          <>
            <button type="button" className="material-quick-action primary" aria-label={`${material.name}の計測を開始`} onClick={onStart}><Timer size={17} aria-hidden="true" />{activeTimer ? '計測中' : '計測'}</button>
            <button type="button" className="material-quick-action" aria-label={`${material.name}を編集`} onClick={onEdit}><Pencil size={17} aria-hidden="true" />編集</button>
          </>
        )}
      </div>
    </div>
  );
}
