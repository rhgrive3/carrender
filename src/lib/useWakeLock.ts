import { useEffect } from 'react';

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

/**
 * タイマー表示中に画面が消灯しないようにする(Screen Wake Lock API)。
 * バックグラウンド復帰時に自動で再取得する。非対応環境では何もしない。
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let disposed = false;

    const request = async () => {
      try {
        const wakeLock = (navigator as unknown as { wakeLock: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock;
        const s = await wakeLock.request('screen');
        if (disposed) {
          void s.release();
        } else {
          sentinel = s;
        }
      } catch {
        // 低電力モード等で拒否されることがある。致命的ではない
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void request();
    };

    void request();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (sentinel) void sentinel.release().catch(() => {});
    };
  }, [active]);
}
