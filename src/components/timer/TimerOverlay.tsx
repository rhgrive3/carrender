import { useEffect, useRef, useState } from 'react';
import { Check, CloudRain, Coffee, Pause, Play, SkipForward, Trash2, VolumeX, Wind, X } from 'lucide-react';
import { useTimer, type TimerTarget } from './TimerContext';
import { useApp } from '../../state/AppContext';
import { formatHM } from '../../lib/date';
import { RecordSheet } from '../forms/RecordSheet';
import { useWakeLock } from '../../lib/useWakeLock';
import { getNoise, setNoise, stopNoise, type NoiseType } from '../../lib/audio';
import { Segmented } from '../ui/bits';

const NOISE_LABEL: Record<NoiseType, string> = { off: '環境音オフ', white: 'ホワイトノイズ', rain: '雨音' };

/** 集中モードの全画面タイマー + 終了後の記録フロー */
export function TimerOverlay() {
  const timer = useTimer();
  const { state } = useApp();
  // 終了時はtimer.targetが消えるため、記録用にスナップショットを保持する
  const [finished, setFinished] = useState<{ target: TimerTarget; minutes: number } | null>(null);
  const [noise, setNoiseState] = useState<NoiseType>(() => getNoise());
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const active = timer.target !== null;
  const isBreak = timer.mode === 'pomodoro' && timer.phase !== 'work';
  const overlayRef = useRef<HTMLDivElement>(null);

  // 全画面ダイアログなのでフォーカスを背後の画面に残さない
  useEffect(() => {
    if (active) overlayRef.current?.focus();
  }, [active]);

  // 画面を消灯させない(設定でオフ可能)
  useWakeLock(active && timer.running && state.settings.timer.keepScreenOn);

  // 環境音は「集中中に再生」: 休憩・一時停止・タイマー終了で止める
  useEffect(() => {
    if (!active || !timer.running || isBreak) {
      stopNoise();
      return;
    }
    setNoise(noise);
    return () => stopNoise();
  }, [active, timer.running, isBreak, noise]);

  useEffect(() => {
    if (!active) setConfirmDiscard(false);
  }, [active]);

  if (finished) {
    return (
      <RecordSheet
        open
        onClose={() => setFinished(null)}
        preset={{
          taskId: finished.target.taskId,
          subjectId: finished.target.subjectId,
          materialId: finished.target.materialId,
          minutes: finished.minutes,
          rangeLabel: finished.target.rangeLabel,
          source: 'timer',
        }}
        onDone={() => setFinished(null)}
      />
    );
  }

  if (!timer.target) return null;

  const subject = state.subjects.find((s) => s.id === timer.target?.subjectId);
  const task = timer.target.taskId ? state.tasks.find((t) => t.id === timer.target?.taskId) : undefined;

  const handleFinish = () => {
    const target = timer.target;
    if (!target) return;
    const minutes = timer.finish();
    stopNoise();
    setConfirmDiscard(false);
    setFinished({ target, minutes });
  };

  const handleDiscard = () => {
    stopNoise();
    setConfirmDiscard(false);
    timer.discard();
  };

  const cycleNoise = () => {
    const order: NoiseType[] = ['off', 'white', 'rain'];
    const next = order[(order.indexOf(noise) + 1) % order.length];
    setNoiseState(next);
  };

  const remainingSec = timer.phaseDurationSec !== null ? Math.max(0, timer.phaseDurationSec - timer.phaseElapsedSec) : 0;
  const phaseLabel = timer.phase === 'work' ? '集中' : timer.phase === 'break' ? '休憩' : '長い休憩';
  const cyclesUntilLong = timer.pomodoro.cyclesUntilLongBreak;

  return (
    <div className="timer-overlay" role="dialog" aria-label="学習タイマー" ref={overlayRef} tabIndex={-1}>
      <div className="timer-topbar">
        <Segmented
          ariaLabel="タイマーの種類"
          options={[
            { value: 'stopwatch', label: 'ストップウォッチ' },
            { value: 'pomodoro', label: '🍅 ポモドーロ' },
          ]}
          value={timer.mode}
          onChange={(m) => timer.setMode(m)}
        />
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setConfirmDiscard(true)}
        >
          破棄
        </button>
      </div>

      {confirmDiscard && (
        <div className="timer-confirm" role="alertdialog" aria-modal="true" aria-label="タイマー破棄の確認">
          <div>
            <div className="timer-confirm-title">タイマーを破棄しますか?</div>
            <div className="faint">記録は保存されません。</div>
          </div>
          <div className="timer-confirm-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDiscard(false)}>
              <X size={14} strokeWidth={2.4} aria-hidden="true" /> キャンセル
            </button>
            <button className="btn btn-danger btn-sm" onClick={handleDiscard}>
              <Trash2 size={14} strokeWidth={2.4} aria-hidden="true" /> 破棄
            </button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, width: '100%' }}>
        {subject && (
          <span className="subject-chip" style={{ background: `${subject.color}26`, color: subject.color, fontSize: 14, padding: '6px 14px' }}>
            {subject.name}
          </span>
        )}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>{timer.target.title}</div>
          <div className="muted">{timer.target.rangeLabel}</div>
          {task && <div className="faint" style={{ marginTop: 5 }}>予定 {task.estimatedMinutes}分</div>}
        </div>

        {timer.mode === 'pomodoro' && (
          <div className={`timer-phase-badge ${isBreak ? 'break' : ''}`}>
            {isBreak ? <Coffee size={14} strokeWidth={2.4} aria-hidden="true" /> : '🍅'} {phaseLabel}
            {timer.phaseDurationSec !== null && ` ${Math.round(timer.phaseDurationSec / 60)}分`}
          </div>
        )}

        <div className={`timer-clock ${timer.running ? 'timer-pulse' : ''} ${isBreak ? 'timer-clock-break' : ''}`} aria-live="off">
          {timer.mode === 'pomodoro' ? formatHM(remainingSec) : formatHM(timer.phaseElapsedSec)}
        </div>

        {timer.mode === 'pomodoro' && (
          <>
            <div className="timer-cycles" aria-label={`${timer.cycle}回の集中を完了`}>
              {Array.from({ length: cyclesUntilLong }, (_, i) => {
                const posInRound = timer.cycle % cyclesUntilLong;
                const roundDone = timer.cycle > 0 && posInRound === 0 && timer.phase === 'longBreak';
                const filled = roundDone ? cyclesUntilLong : posInRound;
                return <span key={i} className={`timer-cycle-dot ${i < filled ? 'done' : ''}`} aria-hidden="true" />;
              })}
              <span className="faint" style={{ marginLeft: 8 }}>累計 {timer.cycle}🍅</span>
            </div>
            <div className="faint" style={{ fontVariantNumeric: 'tabular-nums' }}>
              実勉強時間 {formatHM(timer.workSec)}
            </div>
            {isBreak && (
              <button className="btn btn-secondary btn-sm" onClick={timer.skipBreak}>
                <SkipForward size={14} strokeWidth={2.4} aria-hidden="true" /> 休憩をスキップ
              </button>
            )}
          </>
        )}

        <div className="timer-status-slot" aria-live="polite">
          {!timer.running && <span className="status-badge status-warn">一時停止中</span>}
        </div>

        <button className={`noise-toggle ${noise !== 'off' ? 'on' : ''}`} onClick={cycleNoise} aria-label={`環境音を切り替え(現在: ${NOISE_LABEL[noise]})`}>
          {noise === 'off' ? (
            <VolumeX size={15} strokeWidth={2.2} aria-hidden="true" />
          ) : noise === 'white' ? (
            <Wind size={15} strokeWidth={2.2} aria-hidden="true" />
          ) : (
            <CloudRain size={15} strokeWidth={2.2} aria-hidden="true" />
          )}
          {NOISE_LABEL[noise]}
        </button>
      </div>

      <div style={{ width: '100%', maxWidth: 420, display: 'flex', gap: 12 }}>
        {timer.running ? (
          <button className="btn btn-secondary btn-block" onClick={timer.pause}>
            <Pause size={15} strokeWidth={2.4} fill="currentColor" aria-hidden="true" /> 一時停止
          </button>
        ) : (
          <button className="btn btn-secondary btn-block" onClick={timer.resume}>
            <Play size={15} strokeWidth={2.4} fill="currentColor" aria-hidden="true" /> 再開
          </button>
        )}
        <button className="btn btn-primary btn-block" onClick={handleFinish}>
          <Check size={16} strokeWidth={2.8} aria-hidden="true" /> 終了して記録
        </button>
      </div>
    </div>
  );
}
