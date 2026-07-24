import './safeObjectUrlCleanup';

/**
 * PWAインストール(ホーム画面追加)まわりのプラットフォーム検出とプロンプト管理。
 *
 * beforeinstallpromptはページ読み込み直後に一度だけ発火するため、
 * Reactのマウントを待たずモジュール読み込み時点でリスナーを張る(main.tsxで先にimportされる)。
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type InstallListener = () => void;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<InstallListener>();

function notify() {
  for (const fn of listeners) fn();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    notify();
  });
}

export function subscribeInstall(fn: InstallListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function canPromptInstall(): boolean {
  return deferredPrompt !== null;
}

export function wasInstalledThisSession(): boolean {
  return installed;
}

/** ネイティブのインストールプロンプトを表示する(Android Chrome / デスクトップChrome系) */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) return 'unavailable';
  const ev = deferredPrompt;
  await ev.prompt();
  const choice = await ev.userChoice;
  if (choice.outcome === 'accepted') deferredPrompt = null;
  notify();
  return choice.outcome;
}

/** ホーム画面追加済み(standalone)として起動しているか */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return true;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
  // iOS Safari独自
  return (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+はMac相当のUAを名乗るためタッチ点数で判別
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

export function isMobile(): boolean {
  return isIOS() || isAndroid();
}

/** LINE・Instagram等のアプリ内ブラウザ(ホーム画面追加が不可能な環境) */
export function isInAppBrowser(): boolean {
  const ua = navigator.userAgent;
  return /Line\/|Instagram|FBAN|FBAV|FB_IAB|Twitter|TikTok|MicroMessenger|YJApp/i.test(ua);
}

export function isIOSSafari(): boolean {
  if (!isIOS() || isInAppBrowser()) return false;
  const ua = navigator.userAgent;
  // iOSのChrome/Edge/Firefox等はCriOS/EdgiOS/FxiOSを名乗る(いずれもiOS 16.4+でホーム画面追加可能だが手順が異なる)
  return !/CriOS|EdgiOS|FxiOS|OPiOS|Brave/i.test(ua);
}

/**
 * インストールゲートを表示すべきか。
 * - standalone起動済み → 不要
 * - Playwright等の自動テスト(navigator.webdriver)・localhost開発 → バイパス
 * - ?pwa-gate=on で強制表示(実機・スクショ検証用)、?pwa-gate=off で強制バイパス
 * - モバイルはPWAとして起動する前提。ブラウザ起動時は案内画面を出す
 */
export function shouldShowInstallGate(): boolean {
  if (typeof window === 'undefined') return false;
  const param = new URLSearchParams(window.location.search).get('pwa-gate');
  if (param === 'off') return false;
  if (param === 'on') return true;
  if (isStandalone()) return false;
  if (navigator.webdriver) return false;
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') return false;
  return isMobile();
}
