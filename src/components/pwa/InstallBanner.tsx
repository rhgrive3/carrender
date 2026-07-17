import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { canPromptInstall, isMobile, isStandalone, promptInstall, subscribeInstall } from '../../lib/pwa';

const DISMISS_KEY = 'studycommander_install_banner_dismissed';
const BANNER_TITLE_ID = 'install-banner-title';
const BANNER_DESCRIPTION_ID = 'install-banner-description';

/**
 * デスクトップ向けのインストール誘導バナー。
 * モバイルはInstallGateで強制するため、ここではネイティブプロンプトが使える環境のみ非ブロッキングで促す。
 */
export function InstallBanner() {
  const [, force] = useState(0);
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
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // sessionStorageが使えなくても表示中セッションでは閉じられる
    }
  };

  const install = () => {
    void promptInstall().catch(() => {
      // ブラウザ側のプロンプト失敗は未処理rejectionにせず、案内を残して再試行可能にする。
    });
  };

  return (
    <section
      className="install-banner"
      role="region"
      aria-labelledby={BANNER_TITLE_ID}
      aria-describedby={BANNER_DESCRIPTION_ID}
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
      <button
        type="button"
        className="btn btn-primary btn-sm"
        aria-describedby={BANNER_DESCRIPTION_ID}
        onClick={install}
      >
        <Download size={14} strokeWidth={2.4} aria-hidden="true" /> インストール
      </button>
      <button
        type="button"
        className="icon-btn install-banner-close"
        aria-label="インストール案内を閉じる"
        aria-describedby={BANNER_DESCRIPTION_ID}
        onClick={dismiss}
      >
        <X size={16} strokeWidth={2.4} aria-hidden="true" />
      </button>
    </section>
  );
}
