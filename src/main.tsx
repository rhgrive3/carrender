import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
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
