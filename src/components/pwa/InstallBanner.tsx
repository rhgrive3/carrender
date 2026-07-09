import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { canPromptInstall, isMobile, isStandalone, promptInstall, subscribeInstall } from '../../lib/pwa';

const DISMISS_KEY = 'studycommander_install_banner_dismissed';

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

  return (
    <div className="install-banner" role="complementary" aria-label="アプリのインストール">
      <span className="install-banner-text">アプリとしてインストールすると、全画面・オフラインで使えます</span>
      <button className="btn btn-primary btn-sm" onClick={() => promptInstall()}>
        <Download size={14} strokeWidth={2.4} aria-hidden="true" /> インストール
      </button>
      <button className="icon-btn install-banner-close" aria-label="バナーを閉じる" onClick={dismiss}>
        <X size={16} strokeWidth={2.4} aria-hidden="true" />
      </button>
    </div>
  );
}
