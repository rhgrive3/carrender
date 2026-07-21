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
import './styles/memory-simple.css';
import './styles/memory-dialog-polish.css';
import './styles/memory-card-ux.css';
import './styles/memory-android-flip-fix.css';
import './styles/memory-compact-fixes.css';
import './styles/memory-bulk-editor.css';
import './styles/record-chart-fixes.css';
import './styles/material-shelf.css';
import './styles/accessibility-polish.css';
import './styles/ios-form-controls.css';
// 永続UX契約: 主要5タブは常にviewport下端へ固定する。
// 新しい画面CSSを追加する場合も、layoutContracts.cssより後ろへ置いてはならない。
import './styles/layoutContracts.css';
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

    const scheduleAnnouncement = () => {
      if (scheduledFrame) return;
      scheduledFrame = requestAnimationFrame(announceCurrentScreen);
    };

    announceCurrentScreen();

    const observer = new MutationObserver(scheduleAnnouncement);
    // 下部ナビとモーダルはfixedの包含ブロック問題を避けるためdocument.body直下へ
    // portalされる。#rootだけを監視すると現在画面の変更を取り逃すため、
    // アプリ本体とportal UIの共通祖先であるbodyを監視する。
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-current', 'aria-hidden', 'aria-label', 'aria-labelledby', 'aria-modal', 'data-app-screen-label', 'hidden', 'inert'],
    });

    return () => {
      observer.disconnect();
      if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
    };
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

function ShellNavigationSemanticsGuard() {
  React.useEffect(() => {
    const connectNavigationToPanels = () => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>('.bottom-nav > button')];
      const panels = [...document.querySelectorAll<HTMLElement>('.shell-tab-panel')];

      buttons.forEach((button, index) => {
        const panel = panels[index];
        if (!panel) return;
        const controlId = `shell-nav-${index}`;
        const panelId = `shell-panel-${index}`;

        // ナビはフォーム外でもtypeを固定し、将来のレイアウト変更でsubmit化しないようにする。
        button.type = 'button';
        button.id = controlId;
        button.setAttribute('aria-controls', panelId);

        // 各画面を名前付きregionとして公開し、ナビ項目から移動先を追跡できるようにする。
        panel.id = panelId;
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-labelledby', controlId);
      });
    };

    connectNavigationToPanels();
    const observer = new MutationObserver(connectNavigationToPanels);
    observer.observe(document.body, { childList: true, subtree: true });
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
            <ShellNavigationSemanticsGuard />
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
