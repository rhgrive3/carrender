import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { today } from '../lib/date';
import { resolveDayRollover } from '../lib/dayRollover';

const DAY_ROLLOVER_CHECK_MS = 30_000;

export function DayRolloverBoundary({ children }: { children: (dayKey: string) => ReactNode }) {
  const [dayKey, setDayKey] = useState(() => today());

  const refreshDay = useCallback(() => {
    const currentDay = today();
    setDayKey((previousDay) => resolveDayRollover(previousDay, currentDay));
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshDay();
    };
    const intervalId = window.setInterval(() => {
      // iPad PWAを前面のまま日付をまたいでも、今日画面と日付依存状態を更新する。
      // 背面中はvisibilitychange/pageshowで復帰時に確認するため、不要な処理を避ける。
      if (document.visibilityState === 'visible') refreshDay();
    }, DAY_ROLLOVER_CHECK_MS);

    window.addEventListener('focus', refreshDay);
    window.addEventListener('pageshow', refreshDay);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshDay);
      window.removeEventListener('pageshow', refreshDay);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshDay]);

  return children(dayKey);
}
