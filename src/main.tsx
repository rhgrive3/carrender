import React from 'react';
import ReactDOM from 'react-dom/client';
// beforeinstallpromptを取り逃さないよう、Reactマウント前にリスナーを登録する
import './lib/pwa';
import App from './App';
import '@fontsource-variable/noto-sans-jp';
import './styles/global.css';
import './styles/ux-audit.css';
import './styles/layoutContracts.css';
import { registerSW } from 'virtual:pwa-register';
import { AppErrorBoundary } from './components/ui/AppErrorBoundary';
import { preserveUnreadableState } from './lib/preserveUnreadableState';

preserveUnreadableState();
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);

// 起動スプラッシュをフェードアウト
requestAnimationFrame(() => {
  const boot = document.getElementById('boot');
  if (boot) {
    setTimeout(() => {
      boot.style.opacity = '0';
      setTimeout(() => boot.remove(), 450);
    }, 250);
  }
});
