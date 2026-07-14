import { useMemo } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { useToast } from '../components/ui/Toast';
import { formatDateShort, formatMinutes } from '../lib/date';

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function PlanHistoryScreen() {
  const { state, execute } = useApp();
  const toast = useToast();
  const revisions = useMemo(
    () => [...(state.planRevisions ?? [])].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [state.planRevisions],
  );
  const summaries = useMemo(
    () => [...(state.historySummaries ?? [])].sort((left, right) => right.month.localeCompare(left.month)),
    [state.historySummaries],
  );

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <div className="screen-title">計画履歴</div>
          <div className="screen-sub">再計算前後の差分と、直近1年より前の月次集計</div>
        </div>
        <History size={24} strokeWidth={2.2} aria-hidden="true" />
      </div>

      <div className="card">
        <div className="section-label" style={{ marginTop: 0 }}>復元について</div>
        <p className="faint" style={{ margin: 0 }}>
          完了済み・進行中の作業は変えず、現在も残っている未完了タスクだけを当時の配置へ戻します。
        </p>
      </div>

      <div className="section-label">計画世代 ({revisions.length}件)</div>
      {revisions.length === 0 ? (
        <div className="card"><p className="faint" style={{ margin: 0 }}>次回の計画再計算から履歴が保存されます。</p></div>
      ) : revisions.map((revision) => {
        const moved = revision.changes.filter((change) => change.kind === 'moved').length;
        const added = revision.changes.filter((change) => change.kind === 'added').length;
        const removed = revision.changes.filter((change) => change.kind === 'removed').length;
        return (
          <div key={revision.id} className="card mt-12">
            <div className="row spread" style={{ alignItems: 'flex-start', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800 }}>{revision.reason}</div>
                <div className="faint mt-8">{formatTimestamp(revision.createdAt)} ・ {formatDateShort(revision.fromDate)}以降</div>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const result = execute({ type: 'RESTORE_PLAN_REVISION', revisionId: revision.id });
                  toast(result.changed ? '現在の完了状況を保ったまま配置を復元しました' : '復元できる未完了タスクはありませんでした');
                }}
              >
                <RotateCcw size={14} strokeWidth={2.4} aria-hidden="true" /> 復元
              </button>
            </div>
            <div className="material-metrics mt-8">
              <span><i>変更</i><b>{revision.changes.length}件</b></span>
              <span><i>移動</i><b>{moved}件</b></span>
              <span><i>追加/削除</i><b>{added}/{removed}</b></span>
            </div>
            {revision.materialChanges.slice(0, 4).map((change) => {
              const material = state.materials.find((item) => item.id === change.materialId);
              return (
                <div key={change.materialId} className="faint mt-8">
                  {material?.name ?? change.materialId}: {change.changedTasks}件変更・{change.movedTasks}件移動
                  {change.beforeMinutes !== change.afterMinutes && ` (${formatMinutes(change.beforeMinutes)}→${formatMinutes(change.afterMinutes)})`}
                </div>
              );
            })}
            {revision.changes.slice(0, 5).map((change) => (
              <div key={`${revision.id}:${change.key}`} className="faint mt-8">
                {change.kind === 'moved' ? '移動' : change.kind === 'added' ? '追加' : change.kind === 'removed' ? '削除' : '更新'}: {change.title}
                {change.before && change.after && change.before.scheduledDate !== change.after.scheduledDate
                  ? ` ${formatDateShort(change.before.scheduledDate)}→${formatDateShort(change.after.scheduledDate)}`
                  : ''}
              </div>
            ))}
          </div>
        );
      })}

      <div className="section-label">1年より前の月次集計 ({summaries.length}件)</div>
      {summaries.length === 0 ? (
        <div className="card"><p className="faint" style={{ margin: 0 }}>まだ圧縮対象の履歴はありません。</p></div>
      ) : summaries.map((summary) => (
        <div key={summary.month} className="card mt-12">
          <div className="row spread"><b>{summary.month.replace('-', '年')}月</b><span className="faint">{summary.sessionCount}記録</span></div>
          <div className="material-metrics mt-8">
            <span><i>学習</i><b>{formatMinutes(summary.studyMinutes)}</b></span>
            <span><i>完了</i><b>{summary.completedTaskCount}件</b></span>
            <span><i>未達予定</i><b>{formatMinutes(summary.missedMinutes)}</b></span>
          </div>
        </div>
      ))}
    </div>
  );
}
