import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { canPromptInstall, isMobile, isStandalone, promptInstall, subscribeInstall } from '../../lib/pwa';

const DISMISS_KEY = 'studycommander_install_banner_dismissed';
const BANNER_TITLE_ID = 'install-banner-title';
const BANNER_DESCRIPTION_ID = 'install-banner-description';
const BANNER_STATUS_ID = 'install-banner-status';

/**
 * デスクトップ向けのインストール誘導バナー。
 * モバイルはInstallGateで強制するため、ここではネイティブプロンプトが使える環境のみ非ブロッキングで促す。
 */
export function InstallBanner() {
  const [, force] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => subscribeInstall(() => force((n) => n + 1)), []);

  if (dismissed || isStandalone() || isMobile() || !canPromptInstall()) return null;

  const dismiss = () => {
    if (busy) return;
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // sessionStorageが使えなくても表示中セッションでは閉じられる
    }
  };

  const install = async () => {
    // ネイティブプロンプトは同時に複数表示できないため、処理中の連打を一つの操作へまとめる。
    if (busy) return;
    setBusy(true);
    setStatus('インストール確認を開いています');
    try {
      const result = await promptInstall();
      if (result === 'dismissed') {
        setStatus('インストールはキャンセルされました。必要ならもう一度試せます');
      } else if (result === 'unavailable') {
        setStatus('インストール確認を利用できません。ブラウザのメニューからインストールしてください');
      }
    } catch {
      setStatus('インストール確認を開けませんでした。時間をおいてもう一度試してください');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="install-banner"
      role="region"
      aria-labelledby={BANNER_TITLE_ID}
      aria-describedby={`${BANNER_DESCRIPTION_ID} ${BANNER_STATUS_ID}`}
      aria-busy={busy}
    >
      <span id={BANNER_TITLE_ID} className="sr-only">アプリのインストール</span>
      <span
        id={BANNER_DESCRIPTION_ID}
        className="install-banner-text"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        アプリとしてインストールすると、全画面・オフラインで使えます
      </span>
      <span id={BANNER_STATUS_ID} className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {status}
      </span>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        aria-describedby={`${BANNER_DESCRIPTION_ID} ${BANNER_STATUS_ID}`}
        aria-busy={busy}
        disabled={busy}
        onClick={() => { void install(); }}
      >
        <Download size={14} strokeWidth={2.4} aria-hidden="true" />
        {busy ? '確認中…' : 'インストール'}
      </button>
      <button
        type="button"
        className="icon-btn install-banner-close"
        aria-label="インストール案内を閉じる"
        aria-describedby={BANNER_DESCRIPTION_ID}
        disabled={busy}
        onClick={dismiss}
      >
        <X size={16} strokeWidth={2.4} aria-hidden="true" />
      </button>
    </section>
  );
}
