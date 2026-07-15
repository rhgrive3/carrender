import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { today } from '../lib/date';
import { resolveDayRollover } from '../lib/dayRollover';

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

    window.addEventListener('focus', refreshDay);
    window.addEventListener('pageshow', refreshDay);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', refreshDay);
      window.removeEventListener('pageshow', refreshDay);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshDay]);

  return children(dayKey);
}
