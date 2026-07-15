import { CloudOff, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react';
import { useApp } from '../state/AppContext';
import './SyncStatusBanner.css';

export function SyncStatusBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { syncStatus, hasUnsyncedChanges, retrySync, localSaveError } = useApp();

  const notice = localSaveError
    ? {
        tone: 'error' as const,
        title: '端末への保存を確認できません',
        detail: 'データ管理からJSONを書き出し、端末の空き容量を確認してください。',
        icon: ShieldAlert,
      }
    : syncStatus === 'conflict'
      ? {
          tone: 'error' as const,
          title: '同期内容の確認が必要です',
          detail: '端末版とクラウド版の両方に変更があります。自動では上書きしません。',
          icon: ShieldAlert,
        }
      : syncStatus === 'error'
        ? {
            tone: 'error' as const,
            title: 'クラウド同期に失敗しました',
            detail: hasUnsyncedChanges ? '変更内容はこの端末に保存済みです。' : 'クラウドの保存状態を確認できません。',
            icon: CloudOff,
          }
        : syncStatus === 'offline' && hasUnsyncedChanges
          ? {
              tone: 'warning' as const,
              title: 'オフラインで保存中です',
              detail: '変更内容は端末に保存し、オンライン復帰後に自動同期します。',
              icon: WifiOff,
            }
          : null;

  if (!notice) return null;
  const Icon = notice.icon;
  const canRetry = !localSaveError && syncStatus !== 'conflict';

  return (
    <div className="sync-status-slot">
      <section
        className={`sync-status-banner sync-status-${notice.tone}`}
        role={notice.tone === 'error' ? 'alert' : 'status'}
        aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
      >
        <span className="sync-status-icon"><Icon size={17} strokeWidth={2.3} aria-hidden="true" /></span>
        <span className="sync-status-copy">
          <b>{notice.title}</b>
          <small>{notice.detail}</small>
        </span>
        <span className="sync-status-actions">
          {canRetry && (
            <button type="button" onClick={retrySync} aria-label="クラウド同期を再試行">
              <RefreshCw size={14} strokeWidth={2.4} aria-hidden="true" /> 再試行
            </button>
          )}
          <button type="button" onClick={onOpenSettings}>確認</button>
        </span>
      </section>
    </div>
  );
}
