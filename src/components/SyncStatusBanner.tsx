import { CloudOff, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react';
import { useApp } from '../state/AppContext';
import './SyncStatusBanner.css';

export function SyncStatusBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { syncStatus, hasUnsyncedChanges, retrySync, localSaveError, planningStatus, planningErrorMessage, retryPlanning } = useApp();

  const notice = planningStatus === 'error'
    ? {
        tone: 'error' as const,
        title: '記録は保存しましたが、計画を再計算できませんでした',
        detail: planningErrorMessage ?? '記録データは端末に保持されています。再試行できます。',
        icon: ShieldAlert,
        action: 'planning' as const,
      }
    : planningStatus === 'planning'
      ? {
          tone: 'warning' as const,
          title: '記録を保存し、計画を再計算しています',
          detail: 'この画面はそのまま操作できます。新しい計画だけを後から反映します。',
          icon: RefreshCw,
          action: 'none' as const,
        }
      : localSaveError
    ? {
        tone: 'warning' as const,
        title: '緊急バックアップを更新できません',
        detail: 'iPad本体の空き容量とは別の、ブラウザ内の保存上限です。IndexedDBとクラウド同期は継続します。',
        icon: ShieldAlert,
        action: 'none' as const,
      }
    : syncStatus === 'conflict'
      ? {
          tone: 'error' as const,
          title: '同期内容の確認が必要です',
          detail: '端末版とクラウド版の両方に変更があります。自動では上書きしません。',
          icon: ShieldAlert,
          action: 'none' as const,
        }
      : syncStatus === 'error'
        ? {
            tone: 'error' as const,
            title: 'クラウド同期に失敗しました',
            detail: hasUnsyncedChanges ? '変更内容はこの端末に保存済みです。' : 'クラウドの保存状態を確認できません。',
            icon: CloudOff,
            action: 'sync' as const,
          }
        : syncStatus === 'offline' && hasUnsyncedChanges
          ? {
              tone: 'warning' as const,
              title: 'オフラインで保存中です',
              detail: '変更内容は端末に保存し、オンライン復帰後に自動同期します。',
              icon: WifiOff,
              action: 'sync' as const,
            }
          : null;

  if (!notice) return null;
  const Icon = notice.icon;
  const canRetry = notice.action === 'planning' || (notice.action === 'sync' && !localSaveError && syncStatus !== 'conflict');
  const noticeId = `sync-status-${notice.tone}`;
  const titleId = `${noticeId}-title`;
  const detailId = `${noticeId}-detail`;

  return (
    <div className="sync-status-slot">
      <section
        className={`sync-status-banner sync-status-${notice.tone}`}
        role={notice.tone === 'error' ? 'alert' : 'status'}
        aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
        aria-atomic="true"
        aria-labelledby={titleId}
        aria-describedby={detailId}
      >
        <span className="sync-status-icon"><Icon size={17} strokeWidth={2.3} aria-hidden="true" /></span>
        <span className="sync-status-copy">
          <b id={titleId}>{notice.title}</b>
          <small id={detailId}>{notice.detail}</small>
        </span>
        <span className="sync-status-actions" role="group" aria-label="同期状態の操作">
          {canRetry && (
            <button type="button" onClick={notice.action === 'planning' ? retryPlanning : retrySync} aria-label={notice.action === 'planning' ? '計画の再計算を再試行' : 'クラウド同期を再試行'}>
              <RefreshCw size={14} strokeWidth={2.4} aria-hidden="true" /> 再試行
            </button>
          )}
          <button type="button" onClick={onOpenSettings} aria-label="同期設定を確認">確認</button>
        </span>
      </section>
    </div>
  );
}
