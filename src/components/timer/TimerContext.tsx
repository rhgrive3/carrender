import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PomodoroSettings, TimerMode } from '../../types';
import { useApp } from '../../state/AppContext';
import { useAuth } from '../../state/AuthContext';
import { playChime, vibrate } from '../../lib/audio';
import { showTimerNotification } from '../../lib/notify';

export interface TimerTarget {
  taskId: string | null;
  subjectId: string;
  materialId: string | null;
  title: string;
  rangeLabel: string;
  sourceId?: string;
  range?: { start: number; end: number };
  type?: 'new' | 'review' | 'mockReview' | 'pastExam';
}

export type TimerPhase = 'work' | 'break' | 'longBreak';

interface PersistedTimer {
  target: TimerTarget;
  mode: TimerMode;
  /** 実行中なら現在の走行開始エポックms、停止中ならnull */
  runningSince: number | null;
  /** ポモドーロの現フェーズ(ストップウォッチは常にwork) */
  phase: TimerPhase;
  /** 完了した集中フェーズ数 */
  cycle: number;
  /** 現フェーズの停止中までの累積秒(ストップウォッチは全体の累積) */
  phaseAccumulatedSec: number;
  /** 完了済み集中フェーズの合計秒(ポモドーロ) */
  workCompletedSec: number;
  /** 終了済みで、まだ記録シートの保存を確定していない時間(分) */
  pendingRecordMinutes?: number;
  /** 共用端末で別アカウントへ復元しないための所有者 */
  owner: string;
}

interface TimerContextValue {
  target: TimerTarget | null;
  mode: TimerMode;
  running: boolean;
  phase: TimerPhase;
  /** 完了した集中フェーズ数 */
  cycle: number;
  /** 現フェーズの経過秒 */
  phaseElapsedSec: number;
  /** 現フェーズの長さ(秒)。ストップウォッチではnull */
  phaseDurationSec: number | null;
  /** 実勉強時間(休憩を除く)の秒数 */
  workSec: number;
  pendingRecord: boolean;
  pomodoro: PomodoroSettings;
  start: (target: TimerTarget, mode?: TimerMode) => void;
  setMode: (mode: TimerMode) => void;
  pause: () => void;
  resume: () => void;
  /** 休憩を飛ばして次の集中へ */
  skipBreak: () => void;
  /** 終了して実勉強分数を返す */
  finish: () => number;
  confirmRecordSaved: () => void;
  discard: () => void;
}

const KEY = 'studycommander_timer_v1';
const TimerCtx = createContext<TimerContextValue | null>(null);

/** アプリを閉じたままフェーズ境界を大きく超えていた場合は境界で自動一時停止する猶予(秒) */
const AUTO_PAUSE_GRACE_SEC = 90;

function loadPersisted(owner: string | null): PersistedTimer | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PersistedTimer> & { accumulatedSec?: number };
    if (!p.target || !owner || p.owner !== owner) return null;
    // 旧形式(ストップウォッチのみ)からの移行
    return {
      target: p.target,
      mode: p.mode ?? 'stopwatch',
      runningSince: p.runningSince ?? null,
      phase: p.phase ?? 'work',
      cycle: p.cycle ?? 0,
      phaseAccumulatedSec: p.phaseAccumulatedSec ?? p.accumulatedSec ?? 0,
      workCompletedSec: p.workCompletedSec ?? 0,
      pendingRecordMinutes: p.pendingRecordMinutes,
      owner: p.owner,
    };
  } catch {
    return null;
  }
}

function runSecOf(p: PersistedTimer, now: number): number {
  return p.runningSince ? Math.max(0, Math.floor((now - p.runningSince) / 1000)) : 0;
}

function phaseDurationSecOf(p: PersistedTimer, pomo: PomodoroSettings): number | null {
  if (p.mode !== 'pomodoro') return null;
  const minutes =
    p.phase === 'work' ? pomo.workMinutes : p.phase === 'break' ? pomo.breakMinutes : pomo.longBreakMinutes;
  return minutes * 60;
}

function workSecOf(p: PersistedTimer, now: number, pomo: PomodoroSettings): number {
  const phaseElapsed = p.phaseAccumulatedSec + runSecOf(p, now);
  if (p.mode === 'stopwatch') return phaseElapsed;
  if (p.phase !== 'work') return p.workCompletedSec;
  const dur = phaseDurationSecOf(p, pomo) ?? Infinity;
  return p.workCompletedSec + Math.min(phaseElapsed, dur);
}

/** フェーズ完了後の次状態を返す */
function advancePhase(p: PersistedTimer, pomo: PomodoroSettings, now: number): PersistedTimer {
  const dur = phaseDurationSecOf(p, pomo) ?? 0;
  const phaseElapsed = p.phaseAccumulatedSec + runSecOf(p, now);
  const overshoot = phaseElapsed - dur;
  // 長時間放置していた場合は境界で一時停止して戻ってきたユーザーに委ねる
  const keepRunning = overshoot <= AUTO_PAUSE_GRACE_SEC;

  if (p.phase === 'work') {
    const cycle = p.cycle + 1;
    const nextPhase: TimerPhase = cycle % pomo.cyclesUntilLongBreak === 0 ? 'longBreak' : 'break';
    return {
      ...p,
      phase: nextPhase,
      cycle,
      workCompletedSec: p.workCompletedSec + dur,
      phaseAccumulatedSec: keepRunning ? Math.min(overshoot, AUTO_PAUSE_GRACE_SEC) : 0,
      runningSince: keepRunning ? now : null,
    };
  }
  return {
    ...p,
    phase: 'work',
    phaseAccumulatedSec: keepRunning ? Math.min(overshoot, AUTO_PAUSE_GRACE_SEC) : 0,
    runningSince: keepRunning ? now : null,
  };
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const { state } = useApp();
  const { user } = useAuth();
  const timerSettings = state.settings.timer;
  const pomo = timerSettings.pomodoro;

  const [persisted, setPersisted] = useState<PersistedTimer | null>(() => loadPersisted(user?.username ?? null));
  const [now, setNow] = useState(() => Date.now());
  const persistedRef = useRef(persisted);
  persistedRef.current = persisted;
  const pomoRef = useRef(pomo);
  pomoRef.current = pomo;
  const settingsRef = useRef(timerSettings);
  settingsRef.current = timerSettings;

  useEffect(() => {
    try {
      if (persisted) localStorage.setItem(KEY, JSON.stringify(persisted));
      else localStorage.removeItem(KEY);
    } catch {
      // 保存失敗は致命的でない
    }
  }, [persisted]);

  /** フェーズ境界チェック(ポモドーロ)。チャイム等の副作用があるためreducer外で行う */
  const maybeAdvance = useCallback(() => {
    const p = persistedRef.current;
    if (!p || p.mode !== 'pomodoro' || !p.runningSince) return;
    const nowMs = Date.now();
    const dur = phaseDurationSecOf(p, pomoRef.current);
    if (dur === null) return;
    const phaseElapsed = p.phaseAccumulatedSec + runSecOf(p, nowMs);
    if (phaseElapsed < dur) return;

    const endedPhase = p.phase;
    const next = advancePhase(p, pomoRef.current, nowMs);
    setPersisted(next);

    const s = settingsRef.current;
    if (s.sound) playChime(endedPhase === 'work' ? 'workEnd' : 'breakEnd');
    if (s.vibration) vibrate(endedPhase === 'work' ? [180, 90, 180] : [90, 60, 90]);
    if (s.notification) {
      if (endedPhase === 'work') {
        const label = next.phase === 'longBreak' ? `長い休憩(${pomoRef.current.longBreakMinutes}分)` : `休憩(${pomoRef.current.breakMinutes}分)`;
        void showTimerNotification('集中タイム終了 🍅', `おつかれさま!${label}にしましょう`);
      } else {
        void showTimerNotification('休憩終了', '次の集中タイムを始めましょう');
      }
    }
  }, []);

  useEffect(() => {
    if (!persisted?.runningSince) return;
    const id = setInterval(() => {
      setNow(Date.now());
      maybeAdvance();
    }, 500);
    return () => clearInterval(id);
  }, [persisted?.runningSince, maybeAdvance]);

  const start = useCallback((target: TimerTarget, mode?: TimerMode) => {
    const nowMs = Date.now();
    setNow(nowMs);
    setPersisted({
      target,
      mode: mode ?? settingsRef.current.defaultMode,
      runningSince: nowMs,
      phase: 'work',
      cycle: 0,
      phaseAccumulatedSec: 0,
      workCompletedSec: 0,
      owner: user?.username ?? '',
    });
  }, []);

  /** モード切替。それまでの実勉強時間は引き継ぐ */
  const setMode = useCallback((mode: TimerMode) => {
    setPersisted((p) => {
      if (!p || p.mode === mode) return p;
      const nowMs = Date.now();
      const workSec = workSecOf(p, nowMs, pomoRef.current);
      const running = p.runningSince !== null;
      if (mode === 'pomodoro') {
        return {
          ...p,
          mode,
          phase: 'work',
          cycle: 0,
          workCompletedSec: workSec,
          phaseAccumulatedSec: 0,
          runningSince: running ? nowMs : null,
        };
      }
      return {
        ...p,
        mode,
        phase: 'work',
        cycle: 0,
        workCompletedSec: 0,
        phaseAccumulatedSec: workSec,
        runningSince: running ? nowMs : null,
      };
    });
  }, []);

  const pause = useCallback(() => {
    setPersisted((p) => {
      if (!p || !p.runningSince) return p;
      return {
        ...p,
        phaseAccumulatedSec: p.phaseAccumulatedSec + Math.floor((Date.now() - p.runningSince) / 1000),
        runningSince: null,
      };
    });
  }, []);

  const resume = useCallback(() => {
    setNow(Date.now());
    setPersisted((p) => (p && !p.runningSince ? { ...p, runningSince: Date.now() } : p));
  }, []);

  const skipBreak = useCallback(() => {
    setNow(Date.now());
    setPersisted((p) => {
      if (!p || p.mode !== 'pomodoro' || p.phase === 'work') return p;
      return { ...p, phase: 'work', phaseAccumulatedSec: 0, runningSince: p.runningSince ? Date.now() : null };
    });
  }, []);

  const finish = useCallback((): number => {
    const p = persistedRef.current ?? loadPersisted(user?.username ?? null);
    if (!p) return 0;
    if (p.pendingRecordMinutes !== undefined) return p.pendingRecordMinutes;
    const workSec = workSecOf(p, Date.now(), pomoRef.current);
    const minutes = Math.max(1, Math.round(workSec / 60));
    const pending = { ...p, runningSince: null, pendingRecordMinutes: minutes };
    persistedRef.current = pending;
    setPersisted(pending);
    return minutes;
  }, [user?.username]);

  const confirmRecordSaved = useCallback(() => {
    persistedRef.current = null;
    setPersisted(null);
  }, []);

  const discard = useCallback(() => {
    persistedRef.current = null;
    setPersisted(null);
    setNow(Date.now());
    try {
      localStorage.removeItem(KEY);
    } catch {
      // 保存失敗は致命的でない
    }
  }, []);

  const phaseElapsedSec = persisted ? persisted.phaseAccumulatedSec + runSecOf(persisted, now) : 0;
  const phaseDurationSec = persisted ? phaseDurationSecOf(persisted, pomo) : null;
  const workSec = persisted ? workSecOf(persisted, now, pomo) : 0;

  const value = useMemo(
    () => ({
      target: persisted?.target ?? null,
      mode: persisted?.mode ?? timerSettings.defaultMode,
      running: !!persisted?.runningSince,
      phase: persisted?.phase ?? 'work',
      cycle: persisted?.cycle ?? 0,
      phaseElapsedSec,
      phaseDurationSec,
      workSec,
      pendingRecord: persisted?.pendingRecordMinutes !== undefined,
      pomodoro: pomo,
      start,
      setMode,
      pause,
      resume,
      skipBreak,
      finish,
      confirmRecordSaved,
      discard,
    }),
    [persisted, phaseElapsedSec, phaseDurationSec, workSec, pomo, timerSettings.defaultMode, start, setMode, pause, resume, skipBreak, finish, confirmRecordSaved, discard],
  );

  return <TimerCtx.Provider value={value}>{children}</TimerCtx.Provider>;
}

export function useTimer(): TimerContextValue {
  const ctx = useContext(TimerCtx);
  if (!ctx) throw new Error('useTimer must be used within TimerProvider');
  return ctx;
}
