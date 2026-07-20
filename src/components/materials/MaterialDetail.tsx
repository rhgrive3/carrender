import { Flag, Pencil, Timer } from 'lucide-react';
import { useApp } from '../../state/AppContext';
import type { Material } from '../../types';
import { diffDays, formatDateShort, formatMinutes, today } from '../../lib/date';
import { computeMaterialForecast, todayQuotaFor } from '../../lib/analytics';
import { ProgressBar } from '../ui/bits';

export function MaterialDetail({ material, onEdit, onStart, timerActive }: {
  material: Material;
  onEdit: () => void;
  onStart: () => void;
  timerActive: boolean;
}) {
  const { state } = useApp();
  const t = today();
  const subject = state.subjects.find((item) => item.id === material.subjectId);
  const forecast = computeMaterialForecast(state, material.id, t);
  const rate = material.totalAmount > 0 ? material.doneAmount / material.totalAmount : 0;
  const quota = todayQuotaFor(state, material.id, t);
  const daysLeft = diffDays(t, material.targetDate);
  const progressDeficit = state.lastScheduleResult?.progressDeficits.find((item) => item.materialId === material.id);
  const done = material.doneAmount >= material.totalAmount;

  return (
    <aside className="material-detail-panel" aria-label={`${material.name}の詳細`}>
      <div className="material-detail-head">
        <div>
          <span className="subject-chip" style={{ background: `${subject?.color}20`, color: subject?.color }}>{subject?.name}</span>
          <h2>{material.name}</h2>
        </div>
      </div>
      <div className="material-progress-display">
        <strong>{Math.round(rate * 100)}%</strong>
        <span>{material.doneAmount} / {material.totalAmount}{material.unit}</span>
        <ProgressBar value={rate} color={subject?.color} />
      </div>
      {!material.archived && (
        <div className="material-detail-actions">
          <button type="button" className="btn btn-primary" onClick={onStart}><Timer size={16} aria-hidden="true" />{timerActive ? 'この教材を計測中' : 'この教材で計測'}</button>
          <button type="button" className="btn btn-secondary" onClick={onEdit}><Pencil size={15} aria-hidden="true" />編集</button>
        </div>
      )}
      <dl className="material-detail-metrics">
        <div><dt>期限まで</dt><dd className={daysLeft < 0 ? 'critical' : ''}>{done ? '完了' : daysLeft < 0 ? `${Math.abs(daysLeft)}日超過` : `${daysLeft}日`}</dd></div>
        <div><dt>今日の目安</dt><dd>{done ? 'なし' : quota > 0 ? `${quota}${material.unit}` : '調整中'}</dd></div>
        <div><dt>必要ペース</dt><dd>{forecast ? `${forecast.requiredPacePerDay}${material.unit}/日` : '計算中'}</dd></div>
      </dl>
      {progressDeficit && progressDeficit.units > 0 && (
        <div className="status-banner warning">
          <Flag size={18} aria-hidden="true" />
          <div className="status-banner-copy"><strong>期限に間に合わせるには、あと{progressDeficit.units}{material.unit}必要です</strong><span>学習時間の目安は{formatMinutes(progressDeficit.minutes)}です。</span></div>
        </div>
      )}
      {forecast?.projectedFinishDate && !done && (
        <div className="material-forecast-line">
          <span>現在ペースの完了見込み</span>
          <strong className={forecast.status === 'risk' ? 'critical' : forecast.status === 'behind' ? 'warning' : ''}>{formatDateShort(forecast.projectedFinishDate)}</strong>
        </div>
      )}
      {material.estimatedMinutesPerUnit && material.estimateMode !== 'fixed' && (
        <p className="material-estimate-note">実績から、1{material.unit}あたり約{material.estimatedMinutesPerUnit.toFixed(1)}分と推定しています。</p>
      )}
    </aside>
  );
}
