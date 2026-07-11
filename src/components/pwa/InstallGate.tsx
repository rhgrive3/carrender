import { useEffect, useState } from 'react';
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

/**
 * ホーム画面追加を必須にする全画面ゲート。
 * モバイルのブラウザ起動時はこの画面しか表示されず、インストールするまでアプリを使えない。
 */
export function InstallGate() {
  const [, force] = useState(0);
  const [copied, setCopied] = useState(false);
  const [promptBusy, setPromptBusy] = useState(false);

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
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードが使えない環境ではURLを見せるだけ
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
    <div className="install-gate" role="dialog" aria-label="ホーム画面に追加">
      <div className="install-gate-inner">
        <div className="install-logo" aria-hidden="true">
          <Target size={34} strokeWidth={2} color="#fff" />
        </div>
        <h1 className="install-title">StudyCommander</h1>

        {installed ? (
          <>
            <div className="install-done" role="status">
              <PartyPopper size={38} strokeWidth={1.8} aria-hidden="true" />
              <div className="install-done-title">インストール完了!</div>
              <p className="install-lead">
                ホーム画面に <b>StudyCmdr</b> のアイコンが追加されました。
                <br />
                ホーム画面のアイコンから起動してください。
              </p>
            </div>
          </>
        ) : (
          <>
            <p className="install-lead">
              StudyCommanderは<b>ホーム画面から起動するアプリ</b>です。
              <br />
              利用するには、まずホーム画面に追加してください。
            </p>

            <div className="install-benefits">
              <span className="iflex"><Zap size={14} strokeWidth={2.4} aria-hidden="true" /> 全画面・高速起動</span>
              <span className="iflex"><WifiOff size={14} strokeWidth={2.4} aria-hidden="true" /> オフラインでも使える</span>
              <span className="iflex"><CircleCheck size={14} strokeWidth={2.4} aria-hidden="true" /> 通知・タイマーが安定</span>
            </div>

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

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="install-step">
      <span className="install-step-num" aria-hidden="true">{n}</span>
      <span className="install-step-body">{children}</span>
    </div>
  );
}

/** iOS: Safariの共有メニューから追加 */
function IOSSteps({ safari }: { safari: boolean }) {
  return (
    <div className="install-steps">
      {safari ? (
        <>
          <Step n={1}>
            画面下の共有ボタン
            <span className="install-inline-icon" aria-hidden="true"><Share size={15} strokeWidth={2.2} /></span>
            をタップ
          </Step>
          <Step n={2}>
            <b>「ホーム画面に追加」</b>
            <span className="install-inline-icon" aria-hidden="true"><SquarePlus size={15} strokeWidth={2.2} /></span>
            を選ぶ
          </Step>
          <Step n={3}>右上の<b>「追加」</b>をタップ</Step>
        </>
      ) : (
        <>
          <Step n={1}>
            アドレスバー横の共有
            <span className="install-inline-icon" aria-hidden="true"><Share size={15} strokeWidth={2.2} /></span>
            またはメニュー
            <span className="install-inline-icon" aria-hidden="true"><EllipsisVertical size={15} strokeWidth={2.2} /></span>
            を開く
          </Step>
          <Step n={2}>
            <b>「ホーム画面に追加」</b>を選ぶ
          </Step>
          <Step n={3}>
            見つからない場合はこのページを<b>Safariで開いて</b>同じ手順を行ってください
          </Step>
        </>
      )}
    </div>
  );
}

/** Android: ネイティブプロンプトが使えれば1タップ、なければChromeメニュー手順 */
function AndroidSteps({ canPrompt, busy, onPrompt }: { canPrompt: boolean; busy: boolean; onPrompt: () => void }) {
  if (canPrompt) {
    return (
      <button className="btn btn-primary btn-block install-cta" disabled={busy} onClick={onPrompt}>
        <Download size={18} strokeWidth={2.4} aria-hidden="true" />
        {busy ? '確認中…' : 'ホーム画面に追加する'}
      </button>
    );
  }
  return (
    <div className="install-steps">
      <Step n={1}>
        右上のメニュー
        <span className="install-inline-icon" aria-hidden="true"><EllipsisVertical size={15} strokeWidth={2.2} /></span>
        をタップ
      </Step>
      <Step n={2}>
        <b>「アプリをインストール」</b>または<b>「ホーム画面に追加」</b>を選ぶ
      </Step>
      <Step n={3}>確認画面で<b>「インストール」</b>をタップ</Step>
    </div>
  );
}

/** LINE・Instagram等のアプリ内ブラウザ: 外部ブラウザで開き直してもらう */
function InAppSteps({ copied, onCopy, ios }: { copied: boolean; onCopy: () => void; ios: boolean }) {
  return (
    <div className="install-steps">
      <div className="install-warn" role="note">
        アプリ内ブラウザではホーム画面に追加できません。
        <b>{ios ? 'Safari' : 'Chrome'}で開き直してください。</b>
      </div>
      <Step n={1}>
        右上・右下のメニュー
        <span className="install-inline-icon" aria-hidden="true"><EllipsisVertical size={15} strokeWidth={2.2} /></span>
        から<b>「{ios ? 'Safariで開く' : '他のアプリで開く'}」</b>を選ぶ
      </Step>
      <Step n={2}>
        開けない場合はURLをコピーして{ios ? 'Safari' : 'Chrome'}に貼り付け
        <button className="btn btn-secondary btn-sm install-copy-btn" onClick={onCopy}>
          {copied ? <CircleCheck size={14} strokeWidth={2.4} aria-hidden="true" /> : <Copy size={14} strokeWidth={2.4} aria-hidden="true" />}
          {copied ? 'コピーしました' : 'URLをコピー'}
        </button>
      </Step>
      <Step n={3}>
        {ios ? '共有ボタン' : 'メニュー'}から<b>「ホーム画面に追加」</b>
        <span className="install-inline-icon" aria-hidden="true"><ArrowUpFromLine size={15} strokeWidth={2.2} /></span>
      </Step>
    </div>
  );
}

/** その他(?pwa-gate=onでのデスクトップ確認など) */
function GenericSteps({ canPrompt, busy, onPrompt }: { canPrompt: boolean; busy: boolean; onPrompt: () => void }) {
  if (canPrompt) {
    return (
      <button className="btn btn-primary btn-block install-cta" disabled={busy} onClick={onPrompt}>
        <Download size={18} strokeWidth={2.4} aria-hidden="true" />
        {busy ? '確認中…' : 'アプリとしてインストール'}
      </button>
    );
  }
  return (
    <div className="install-steps">
      <Step n={1}>
        ブラウザのメニューから<b>「インストール」</b>または<b>「ホーム画面に追加」</b>を選んでください
        <span className="install-inline-icon" aria-hidden="true"><ExternalLink size={15} strokeWidth={2.2} /></span>
      </Step>
    </div>
  );
}
