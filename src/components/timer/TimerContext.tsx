import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PomodoroSettings, TimerMode } from '../../types';
import { useApp } from '../../state/AppContext';
import { useAuth } from '../../state/AuthContext';
import { playChime, vibrate } from '../../lib/audio';
import { showTimerNotification } from '../../lib/notify';

interface TimerTarget {
  taskId: string | null;
  subjectId: string;
  materialId: string | null;
  title: string;
  rangeLabel: string;
  sourceId?: string;
  range?: { start: number; end: number };
  type?: 'new' | 'review' | 'mockReview' | 'pastExam';
}

type TimerPhase = 'work' | 'break' | 'longBreak';

interface PersistedTimer {
  target: TimerTarget;
  mode: TimerMode;
  /** 学習全体を最初に開始した不変のエポックms */
  workStartedAt?: number;
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
  /** 最初に学習を開始した日時。旧保存形式で復元不能な場合はnull */
  startedAt: string | null;
  /** 完了した集中フェーズ数 */
  cycle: number;
  /** 現フェーズの経過秒 */
  phaseElapsedSec: number;
  /** 現フェーズの長さ(秒)。ストップウォッチではnull */
  phaseDurationSec: number | null;
  /** 実勉強時間(休憩を除く)の秒数 */
  workSec: number;
  pendingRecord: boolean;
  persistenceError: boolean;
  pomodoro: PomodoroSettings;
  /** 既存タイマーが無い時だけ開始する。開始できた場合はtrue。 */
  start: (target: TimerTarget, mode?: TimerMode) => boolean;
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
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const TIMER_MODES: TimerMode[] = ['stopwatch', 'pomodoro'];
const TIMER_PHASES: TimerPhase[] = ['work', 'break', 'longBreak'];
const TIMER_TYPES = ['new', 'review', 'mockReview', 'pastExam'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validEpoch(value: unknown, now: number): value is number {
  return nonNegativeFinite(value) && value <= now + MAX_FUTURE_CLOCK_SKEW_MS;
}

function validTarget(value: unknown): value is TimerTarget {
  if (!isRecord(value)) return false;
  if (value.taskId !== null && typeof value.taskId !== 'string') return false;
  if (typeof value.subjectId !== 'string' || value.subjectId.length === 0) return false;
  if (value.materialId !== null && typeof value.materialId !== 'string') return false;
  if (typeof value.title !== 'string' || typeof value.rangeLabel !== 'string') return false;
  if (value.sourceId !== undefined && typeof value.sourceId !== 'string') return false;
  if (value.type !== undefined && !TIMER_TYPES.includes(value.type as (typeof TIMER_TYPES)[number])) return false;
  if (value.range !== undefined) {
    if (!isRecord(value.range)) return false;
    if (!Number.isSafeInteger(value.range.start) || !Number.isSafeInteger(value.range.end)) return false;
    if ((value.range.start as number) < 0 || (value.range.end as number) < (value.range.start as number)) return false;
  }
  return true;
}

export function normalizePersistedTimer(
  value: unknown,
  owner: string | null,
  now = Date.now(),
): PersistedTimer | null {
  if (!owner || !isRecord(value) || value.owner !== owner || !validTarget(value.target)) return null;

  const mode = value.mode ?? 'stopwatch';
  if (!TIMER_MODES.includes(mode as TimerMode)) return null;
  const phase = value.phase ?? 'work';
  if (!TIMER_PHASES.includes(phase as TimerPhase)) return null;
  if (mode === 'stopwatch' && phase !== 'work') return null;

  const legacyAccumulatedSec = value.accumulatedSec;
  const phaseAccumulatedSec = value.phaseAccumulatedSec ?? legacyAccumulatedSec ?? 0;
  const workCompletedSec = value.workCompletedSec ?? 0;
  const cycle = value.cycle ?? 0;
  if (!nonNegativeFinite(phaseAccumulatedSec) || !nonNegativeFinite(workCompletedSec)) return null;
  if (!Number.isSafeInteger(cycle) || (cycle as number) < 0) return null;

  const runningSince = value.runningSince ?? null;
  if (runningSince !== null && !validEpoch(runningSince, now)) return null;
  const explicitStartedAt = value.workStartedAt;
  if (explicitStartedAt !== undefined && !validEpoch(explicitStartedAt, now)) return null;
  if (typeof explicitStartedAt === 'number' && typeof runningSince === 'number' && explicitStartedAt > runningSince) return null;

  const pendingRecordMinutes = value.pendingRecordMinutes;
  if (pendingRecordMinutes !== undefined) {
    if (!Number.isSafeInteger(pendingRecordMinutes) || (pendingRecordMinutes as number) < 1) return null;
    if (runningSince !== null) return null;
  }

  const workStartedAt = typeof explicitStartedAt === 'number'
    ? explicitStartedAt
    : typeof runningSince === 'number'
      ? runningSince
      : undefined;

  return {
    target: value.target,
    mode: mode as TimerMode,
    workStartedAt,
    runningSince: runningSince as number | null,
    phase: phase as TimerPhase,
    cycle: cycle as number,
    phaseAccumulatedSec,
    workCompletedSec,
    pendingRecordMinutes: pendingRecordMinutes as number | undefined,
    owner,
  };
}

function loadPersisted(owner: string | null): PersistedTimer | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return normalizePersistedTimer(JSON.parse(raw), owner);
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
  const [persistenceError, setPersistenceError] = useState(false);
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
      setPersistenceError(false);
    } catch {
      setPersistenceError(true);
    }
  }, [persisted]);

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
    if (persistedRef.current) return false;
    const nowMs = Date.now();
    setNow(nowMs);
    const next: PersistedTimer = {
      target,
      mode: mode ?? settingsRef.current.defaultMode,
      workStartedAt: nowMs,
      runningSince: nowMs,
      phase: 'work',
      cycle: 0,
      phaseAccumulatedSec: 0,
      workCompletedSec: 0,
      owner: user?.username ?? '',
    };
    persistedRef.current = next;
    setPersisted(next);
    return true;
  }, [user?.username]);

  /** モード切替。それまでの実勉強時間と最初の開始時刻は引き継ぐ */
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
      setPersistenceError(false);
    } catch {
      setPersistenceError(true);
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
      startedAt: persisted?.workStartedAt ? new Date(persisted.workStartedAt).toISOString() : null,
      cycle: persisted?.cycle ?? 0,
      phaseElapsedSec,
      phaseDurationSec,
      workSec,
      pendingRecord: persisted?.pendingRecordMinutes !== undefined,
      persistenceError,
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
    [persisted, phaseElapsedSec, phaseDurationSec, workSec, persistenceError, pomo, timerSettings.defaultMode, start, setMode, pause, resume, skipBreak, finish, confirmRecordSaved, discard],
  );

  return (
    <TimerCtx.Provider value={value}>
      {children}
      {persistenceError && persisted && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 'max(12px, env(safe-area-inset-top))',
            left: '50%',
            zIndex: 10050,
            width: 'min(calc(100vw - 24px), 520px)',
            transform: 'translateX(-50%)',
            border: '1px solid color-mix(in srgb, #b45309 45%, transparent)',
            borderRadius: 12,
            background: 'color-mix(in srgb, #fff7ed 96%, transparent)',
            padding: '10px 12px',
            color: '#7c2d12',
            fontSize: 14,
            lineHeight: 1.45,
            boxShadow: '0 8px 24px rgba(0,0,0,.12)',
          }}
        >
          タイマーを端末に保存できていません。画面を閉じる前に記録を完了してください。
        </div>
      )}
    </TimerCtx.Provider>
  );
}

export function useTimer(): TimerContextValue {
  const ctx = useContext(TimerCtx);
  if (!ctx) throw new Error('useTimer must be used within TimerProvider');
  return ctx;
}
