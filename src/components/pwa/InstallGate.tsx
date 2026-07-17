import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowUpFromLine,
  CircleCheck,
  Copy,
  Download,
  EllipsisVertical,
  ExternalLink,
  PartyPopper,
  Share,
  SquarePlus,
  Target,
  WifiOff,
  Zap,
} from 'lucide-react';
import {
  canPromptInstall,
  isAndroid,
  isInAppBrowser,
  isIOS,
  isIOSSafari,
  promptInstall,
  subscribeInstall,
  wasInstalledThisSession,
} from '../../lib/pwa';

/** ホーム画面追加を必須にする全画面ゲート。 */
export function InstallGate() {
  const [, force] = useState(0);
  const [copied, setCopied] = useState(false);
  const [promptBusy, setPromptBusy] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => subscribeInstall(() => force((n) => n + 1)), []);

  const installed = wasInstalledThisSession();
  const inApp = isInAppBrowser();
  const ios = isIOS();
  const android = isAndroid();

  const copyUrl = async () => {
    const url = window.location.origin + window.location.pathname;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('このURLをコピーしてブラウザで開いてください', url);
    }
  };

  const doPrompt = async () => {
    setPromptBusy(true);
    try {
      await promptInstall();
    } finally {
      setPromptBusy(false);
    }
  };

  return (
    <div
      className="install-gate"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div className="install-gate-inner">
        <div className="install-logo" aria-hidden="true">
          <Target size={34} strokeWidth={2} color="#fff" />
        </div>
        <h1 id={titleId} className="install-title">StudyCommander</h1>

        {installed ? (
          <div className="install-done" role="status" aria-live="polite" aria-atomic="true">
            <PartyPopper size={38} strokeWidth={1.8} aria-hidden="true" />
            <div className="install-done-title">インストール完了!</div>
            <p id={descriptionId} className="install-lead">
              ホーム画面に <b>StudyCmdr</b> のアイコンが追加されました。
              <br />ホーム画面のアイコンから起動してください。
            </p>
          </div>
        ) : (
          <>
            <p id={descriptionId} className="install-lead">
              StudyCommanderは<b>ホーム画面から起動するアプリ</b>です。
              <br />利用するには、まずホーム画面に追加してください。
            </p>

            <ul className="install-benefits" aria-label="ホーム画面へ追加する利点">
              <li className="iflex"><Zap size={14} strokeWidth={2.4} aria-hidden="true" /> 全画面・高速起動</li>
              <li className="iflex"><WifiOff size={14} strokeWidth={2.4} aria-hidden="true" /> オフラインでも使える</li>
              <li className="iflex"><CircleCheck size={14} strokeWidth={2.4} aria-hidden="true" /> 通知・タイマーが安定</li>
            </ul>

            {inApp ? (
              <InAppSteps copied={copied} onCopy={copyUrl} ios={ios} />
            ) : android ? (
              <AndroidSteps canPrompt={canPromptInstall()} busy={promptBusy} onPrompt={doPrompt} />
            ) : ios ? (
              <IOSSteps safari={isIOSSafari()} />
            ) : (
              <GenericSteps canPrompt={canPromptInstall()} busy={promptBusy} onPrompt={doPrompt} />
            )}
          </>
        )}

        <p className="install-footnote">追加は無料で、アプリストアは不要です。同期・ログイン時は通信を使います。</p>
      </div>
    </div>
  );
}

function Steps({ children, label = 'ホーム画面へ追加する手順' }: { children: ReactNode; label?: string }) {
  return <ol className="install-steps" aria-label={label}>{children}</ol>;
}

function Step({ children }: { children: ReactNode }) {
  return <li className="install-step"><span className="install-step-body">{children}</span></li>;
}

function IOSSteps({ safari }: { safari: boolean }) {
  return (
    <Steps>
      {safari ? (
        <>
          <Step>画面下の共有ボタン <span className="install-inline-icon" aria-hidden="true"><Share size={15} strokeWidth={2.2} /></span> をタップ</Step>
          <Step><b>「ホーム画面に追加」</b> <span className="install-inline-icon" aria-hidden="true"><SquarePlus size={15} strokeWidth={2.2} /></span> を選ぶ</Step>
          <Step>右上の<b>「追加」</b>をタップ</Step>
        </>
      ) : (
        <>
          <Step>アドレスバー横の共有 <span className="install-inline-icon" aria-hidden="true"><Share size={15} strokeWidth={2.2} /></span> またはメニュー <span className="install-inline-icon" aria-hidden="true"><EllipsisVertical size={15} strokeWidth={2.2} /></span> を開く</Step>
          <Step><b>「ホーム画面に追加」</b>を選ぶ</Step>
          <Step>見つからない場合はこのページを<b>Safariで開いて</b>同じ手順を行う</Step>
        </>
      )}
    </Steps>
  );
}

function AndroidSteps({ canPrompt, busy, onPrompt }: { canPrompt: boolean; busy: boolean; onPrompt: () => void }) {
  if (canPrompt) {
    return (
      <button type="button" className="btn btn-primary btn-block install-cta" disabled={busy} aria-busy={busy} onClick={onPrompt}>
        <Download size={18} strokeWidth={2.4} aria-hidden="true" />
        <span aria-live="polite">{busy ? '確認中…' : 'ホーム画面に追加する'}</span>
      </button>
    );
  }
  return (
    <Steps>
      <Step>右上のメニュー <span className="install-inline-icon" aria-hidden="true"><EllipsisVertical size={15} strokeWidth={2.2} /></span> をタップ</Step>
      <Step><b>「アプリをインストール」</b>または<b>「ホーム画面に追加」</b>を選ぶ</Step>
      <Step>確認画面で<b>「インストール」</b>をタップ</Step>
    </Steps>
  );
}

function InAppSteps({ copied, onCopy, ios }: { copied: boolean; onCopy: () => void; ios: boolean }) {
  return (
    <>
      <div className="install-warn" role="note">
        アプリ内ブラウザではホーム画面に追加できません。<b>{ios ? 'Safari' : 'Chrome'}で開き直してください。</b>
      </div>
      <Steps label={`${ios ? 'Safari' : 'Chrome'}で開き直す手順`}>
        <Step>右上・右下のメニュー <span className="install-inline-icon" aria-hidden="true"><EllipsisVertical size={15} strokeWidth={2.2} /></span> から<b>「{ios ? 'Safariで開く' : '他のアプリで開く'}」</b>を選ぶ</Step>
        <Step>
          開けない場合はURLをコピーして{ios ? 'Safari' : 'Chrome'}に貼り付け
          <button type="button" className="btn btn-secondary btn-sm install-copy-btn" onClick={onCopy}>
            {copied ? <CircleCheck size={14} strokeWidth={2.4} aria-hidden="true" /> : <Copy size={14} strokeWidth={2.4} aria-hidden="true" />}
            <span aria-live="polite">{copied ? 'コピーしました' : 'URLをコピー'}</span>
          </button>
        </Step>
        <Step>{ios ? '共有ボタン' : 'メニュー'}から<b>「ホーム画面に追加」</b> <span className="install-inline-icon" aria-hidden="true"><ArrowUpFromLine size={15} strokeWidth={2.2} /></span></Step>
      </Steps>
    </>
  );
}

function GenericSteps({ canPrompt, busy, onPrompt }: { canPrompt: boolean; busy: boolean; onPrompt: () => void }) {
  if (canPrompt) {
    return (
      <button type="button" className="btn btn-primary btn-block install-cta" disabled={busy} aria-busy={busy} onClick={onPrompt}>
        <Download size={18} strokeWidth={2.4} aria-hidden="true" />
        <span aria-live="polite">{busy ? '確認中…' : 'アプリとしてインストール'}</span>
      </button>
    );
  }
  return (
    <Steps>
      <Step>ブラウザのメニューから<b>「インストール」</b>または<b>「ホーム画面に追加」</b>を選ぶ <span className="install-inline-icon" aria-hidden="true"><ExternalLink size={15} strokeWidth={2.2} /></span></Step>
    </Steps>
  );
}
