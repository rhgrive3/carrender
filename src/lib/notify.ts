/**
 * タイマー通知(Notification API)。
 * Web Pushサーバーは持たないため、アプリ起動中のフェーズ切り替え通知に限定される。
 * iOSはホーム画面追加(standalone)+iOS 16.4以降でのみ通知が使える。
 */

export function notificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function notificationGranted(): boolean {
  return notificationSupported() && Notification.permission === 'granted';
}

/** 設定画面のトグルから呼ぶ。ユーザー操作起点でないとiOSでは失敗する */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

export async function showTimerNotification(title: string, body: string): Promise<void> {
  if (!notificationGranted()) return;
  const options: NotificationOptions = {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'studycommander-timer',
  };
  try {
    // Service Worker経由の方がモバイルで確実(ページ通知はAndroidで不可)
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, options);
      return;
    }
  } catch {
    // フォールバックへ
  }
  try {
    new Notification(title, options);
  } catch {
    // 通知が出せなくてもアプリ内のチャイムで気づける
  }
}
