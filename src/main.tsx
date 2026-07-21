import React from 'react';
import ReactDOM from 'react-dom/client';
// beforeinstallpromptを取り逃がさないよう、Reactマウント前にリスナーを登録する
import './lib/pwa';
import App from './App';
import '@fontsource-variable/noto-sans-jp';
import './styles/tokens.css';
import './styles/global.css';
import './styles/design-system.css';
import './styles/ux-audit.css';
import './styles/layoutContracts.css';
import './styles/memory-simple.css';
import './styles/memory-dialog-polish.css';
import './styles/memory-card-ux.css';
import './styles/memory-android-flip-fix.css';
import './styles/memory-compact-fixes.css';
import './styles/record-chart-fixes.css';
import './styles/material-shelf.css';
import './styles/accessibility-polish.css';
import './styles/ios-form-controls.css';
import { registerSW } from 'virtual:pwa-register';
import { AppErrorBoundary } from './components/ui/AppErrorBoundary';
import { DayRolloverBoundary } from './components/DayRolloverBoundary';
import { preserveUnreadableState } from './lib/preserveUnreadableState';

const APP_TITLE = 'StudyCommander 学習司令塔';

function textFromIdRefs(value: string | null) {
  if (!value) return '';
  return value
    .trim()
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
}

function NavigationAnnouncement() {
  const [message, setMessage] = React.useState('');
  const lastLabelRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    let scheduledFrame = 0;

    const announceCurrentScreen = () => {
      scheduledFrame = 0;
      const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')];
      const activeDialog = dialogs.reverse().find((element) => !element.closest('[hidden], [inert], [aria-hidden="true"]'));
      const dialogLabel = (
        activeDialog?.getAttribute('aria-label')
        || textFromIdRefs(activeDialog?.getAttribute('aria-labelledby') ?? null)
      )?.trim();
      const contextualLabels = [...document.querySelectorAll<HTMLElement>('[data-app-screen-label]')];
      const contextualLabel = contextualLabels.find((element) => {
        // ラベル要素自体は表示を持たないhiddenマーカーとして置かれる。
        // 背面タブ・モーダル背面だけを除外するため、要素自身ではなく祖先を確認する。
        return !element.parentElement?.closest('[hidden], [inert], [aria-hidden="true"]');
      })?.dataset.appScreenLabel?.trim();
      const current = document.querySelector('.bottom-nav [aria-current="page"]');
      const label = dialogLabel || contextualLabel || current?.getAttribute('aria-label')?.trim() || current?.textContent?.trim();
      if (!label || label === lastLabelRef.current) return;
      lastLabelRef.current = label;
      setMessage(`${label}を表示しました`);
    };

    const scheduleAnnouncement = () => {
      window.cancelAnimationFrame(scheduledFrame);
      scheduledFrame = window.requestAnimationFrame(announceCurrentScreen);
    };

    scheduleAnnouncement();
    const observer = new MutationObserver(scheduleAnnouncement);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current', 'hidden', 'inert', 'aria-hidden'] });
    return () => {
      window.cancelAnimationFrame(scheduledFrame);
      observer.disconnect();
    };
  }, []);

  return <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{message}</div>;
}

preserveUnreadableState();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <DayRolloverBoundary>
        <NavigationAnnouncement />
        <App />
      </DayRolloverBoundary>
    </AppErrorBoundary>
  </React.StrictMode>,
);

document.title = APP_TITLE;

if ('serviceWorker' in navigator) {
  let refreshing = false;
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      if (refreshing) return;
      refreshing = true;
      void updateSW(true);
    },
    onOfflineReady() {
      console.info('オフラインで利用できます');
    },
    onRegisteredSW(_swUrl, registration) {
      // iOSのホーム画面PWAは長時間起動されるため、更新確認を定期実行する。
      window.setInterval(() => { void registration?.update(); }, 60 * 60 * 1000);
    },
  });
}
