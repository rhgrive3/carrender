import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export interface TimerTarget {
  taskId: string | null;
  subjectId: string;
  materialId: string | null;
  title: string;
  rangeLabel: string;
}

interface PersistedTimer {
  target: TimerTarget;
  /** 実行中なら開始エポックms、停止中ならnull */
  runningSince: number | null;
  /** 一時停止までの累積秒 */
  accumulatedSec: number;
}

interface TimerContextValue {
  target: TimerTarget | null;
  running: boolean;
  elapsedSec: number;
  start: (target: TimerTarget) => void;
  pause: () => void;
  resume: () => void;
  /** 終了して経過分数を返す */
  finish: () => number;
  discard: () => void;
}

const KEY = 'studycommander_timer_v1';
const TimerCtx = createContext<TimerContextValue | null>(null);

function loadPersisted(): PersistedTimer | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PersistedTimer) : null;
  } catch {
    return null;
  }
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const [persisted, setPersisted] = useState<PersistedTimer | null>(() => loadPersisted());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    try {
      if (persisted) localStorage.setItem(KEY, JSON.stringify(persisted));
      else localStorage.removeItem(KEY);
    } catch {
      // 保存失敗は致命的でない
    }
  }, [persisted]);

  useEffect(() => {
    if (!persisted?.runningSince) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [persisted?.runningSince]);

  const elapsedSec = persisted
    ? persisted.accumulatedSec + (persisted.runningSince ? Math.floor((now - persisted.runningSince) / 1000) : 0)
    : 0;

  const start = useCallback((target: TimerTarget) => {
    setNow(Date.now());
    setPersisted({ target, runningSince: Date.now(), accumulatedSec: 0 });
  }, []);

  const pause = useCallback(() => {
    setPersisted((p) => {
      if (!p || !p.runningSince) return p;
      return {
        ...p,
        accumulatedSec: p.accumulatedSec + Math.floor((Date.now() - p.runningSince) / 1000),
        runningSince: null,
      };
    });
  }, []);

  const resume = useCallback(() => {
    setNow(Date.now());
    setPersisted((p) => (p && !p.runningSince ? { ...p, runningSince: Date.now() } : p));
  }, []);

  const finish = useCallback((): number => {
    const p = loadPersisted() ?? persisted;
    if (!p) return 0;
    const total = p.accumulatedSec + (p.runningSince ? Math.floor((Date.now() - p.runningSince) / 1000) : 0);
    setPersisted(null);
    return Math.max(1, Math.round(total / 60));
  }, [persisted]);

  const discard = useCallback(() => setPersisted(null), []);

  const value = useMemo(
    () => ({
      target: persisted?.target ?? null,
      running: !!persisted?.runningSince,
      elapsedSec,
      start,
      pause,
      resume,
      finish,
      discard,
    }),
    [persisted, elapsedSec, start, pause, resume, finish, discard],
  );

  return <TimerCtx.Provider value={value}>{children}</TimerCtx.Provider>;
}

export function useTimer(): TimerContextValue {
  const ctx = useContext(TimerCtx);
  if (!ctx) throw new Error('useTimer must be used within TimerProvider');
  return ctx;
}
