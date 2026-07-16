import React from 'react';
import ReactDOM from 'react-dom/client';
// beforeinstallpromptを取り逃さないよう、Reactマウント前にリスナーを登録する
import './lib/pwa';
import App from './App';
import '@fontsource-variable/noto-sans-jp';
import './styles/tokens.css';
import './styles/global.css';
import './styles/design-system.css';
import './styles/ux-audit.css';
import './styles/layoutContracts.css';
import './styles/memory-simple.css';
import './styles/memory-card-ux.css';
import './styles/memory-android-flip-fix.css';
import './styles/memory-compact-fixes.css';
import './styles/record-chart-fixes.css';
import './styles/accessibility-polish.css';
import { registerSW } from 'virtual:pwa-register';
import { AppErrorBoundary } from './components/ui/AppErrorBoundary';
import { DayRolloverBoundary } from './components/DayRolloverBoundary';
import { preserveUnreadableState } from './lib/preserveUnreadableState';

const APP_TITLE = 'StudyCommander 学習司令塔';

function NavigationAnnouncement() {
  const [message, setMessage] = React.useState('');
  const lastLabelRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const announceCurrentScreen = () => {
      const contextualLabels = [...document.querySelectorAll<HTMLElement>('[data-app-screen-label]')];
      const contextualLabel = contextualLabels.find((element) => {
        // ラベル要素自体は表示を持たないhiddenマーカーとして置かれる。
        // 非表示タブだけを除外するため、要素自身ではなく祖先のhiddenを確認する。
        return !element.parentElement?.closest('[hidden]');
      })?.dataset.appScreenLabel?.trim();
      const current = document.querySelector('.bottom-nav [aria-current="page"]');
      const label = contextualLabel || current?.getAttribute('aria-label')?.trim() || current?.textContent?.trim();
      if (!label || label === lastLabelRef.current) return;

      // iPadのタブ一覧・ブラウザ履歴・支援技術でも現在画面を識別できるよう、
      // 視覚上のナビ選択と文書タイトルを常に同じ状態へ揃える。
      document.title = `${label} | ${APP_TITLE}`;

      if (lastLabelRef.current === null) {
        lastLabelRef.current = label;
        return;
      }

      lastLabelRef.current = label;
      setMessage(`${label}画面を表示しました`);
    };

    announceCurrentScreen();

    const root = document.getElementById('root');
    if (!root) return undefined;

    const observer = new MutationObserver(announceCurrentScreen);
    // 下部ナビはfixedの包含ブロック問題を避けるためdocument.body直下へ
    // portalされる。#rootだけを監視するとaria-currentの変更を取り逃すため、
    // アプリ本体とportal UIの共通祖先であるbodyを監視する。
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-current', 'data-app-screen-label', 'hidden'],
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        position: 'fixed',
        width: '1px',
        height: '1px',
        overflow: 'hidden',
        clipPath: 'inset(50%)',
        whiteSpace: 'nowrap',
      }}
    >
      {message}
    </div>
  );
}

function MainLandmarkGuard() {
  React.useEffect(() => {
    const rootMain = document.getElementById('app-main-content');
    if (!rootMain) return undefined;

    const normalizeNestedMain = () => {
      rootMain.querySelectorAll<HTMLElement>('main').forEach((nestedMain) => {
        // アプリ全体のmainを一意に保つ。画面内の視覚レイアウト用mainは
        // regionへ降格し、VoiceOverの「メイン」ランドマーク重複を防ぐ。
        if (!nestedMain.hasAttribute('role')) nestedMain.setAttribute('role', 'region');
        if (!nestedMain.hasAttribute('aria-label') && !nestedMain.hasAttribute('aria-labelledby')) {
          nestedMain.setAttribute('aria-label', '画面の主要コンテンツ');
        }
      });
    };

    normalizeNestedMain();
    const observer = new MutationObserver(normalizeNestedMain);
    observer.observe(rootMain, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}

preserveUnreadableState();
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <DayRolloverBoundary>
        {(dayKey) => (
          <>
            <NavigationAnnouncement />
            <MainLandmarkGuard />
            <a className="skip-link" href="#app-main-content">本文へ移動</a>
            <main id="app-main-content" tabIndex={-1}>
              <App key={dayKey} />
            </main>
          </>
        )}
      </DayRolloverBoundary>
    </AppErrorBoundary>
  </React.StrictMode>,
);

// 起動スプラッシュをフェードアウトする。動きを減らす設定では待機・フェードを挟まず即時解除する。
requestAnimationFrame(() => {
  const boot = document.getElementById('boot');
  if (!boot) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    boot.remove();
    return;
  }

  setTimeout(() => {
    boot.style.opacity = '0';
    setTimeout(() => boot.remove(), 450);
  }, 250);
});
