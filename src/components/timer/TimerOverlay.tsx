import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  CheckCircle2,
  CloudRain,
  Coffee,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pause,
  Play,
  SkipForward,
  Trash2,
  Wind,
  X,
} from 'lucide-react';
import { useTimer } from './TimerContext';
import { useApp } from '../../state/AppContext';
import { formatHM } from '../../lib/date';
import { RecordSheet } from '../forms/RecordSheet';
import { useWakeLock } from '../../lib/useWakeLock';
import { getNoise, setNoise, stopNoise, type NoiseType } from '../../lib/audio';
import { Segmented } from '../ui/bits';
import { Sheet, acquireModalIsolation, trapModalTabKey } from '../ui/Sheet';

const NOISE_LABEL: Record<NoiseType, string> = { off: '環境音オフ', white: 'ホワイトノイズ', rain: '雨音' };

/** 集中モードの全画面タイマー + 終了後の記録フロー */
export function TimerOverlay() {
  const timer = useTimer();
  const { state } = useApp();
  const [recordDismissed, setRecordDismissed] = useState(false);
  const [noise, setNoiseState] = useState<NoiseType>(() => getNoise());
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);

  const active = timer.target !== null;
  const showRecordSheet = Boolean(timer.target && timer.pendingRecord && !recordDismissed);
  const isBreak = timer.mode === 'pomodoro' && timer.phase !== 'work';
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || showRecordSheet || minimized || !overlayRef.current) return;
    const root = overlayRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restoreModalIsolation = acquireModalIsolation(root);
    root.focus();

    const onKey = (event: KeyboardEvent) => {
      // 破棄確認Sheetが重なった時は共有モーダルスタックがタイマーをinert化する。
      if (root.hasAttribute('inert')) return;
      trapModalTabKey(event, root);
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      restoreModalIsolation();
      previousFocus?.focus();
    };
  }, [active, minimized, showRecordSheet]);

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
    if (!active) {
      setConfirmDiscard(false);
      setControlsOpen(false);
      setMinimized(false);
    }
  }, [active]);

  useEffect(() => {
    if (!timer.pendingRecord) setRecordDismissed(false);
  }, [timer.pendingRecord]);

  if (showRecordSheet && timer.target) {
    return (
      <RecordSheet
        open
        // 閉じてもタイマー自体は消さない。次回起動でもこの記録を再開できる。
        onClose={() => {
          setRecordDismissed(true);
          setMinimized(true);
        }}
        preset={{
          taskId: timer.target.taskId,
          subjectId: timer.target.subjectId,
          materialId: timer.target.materialId,
          minutes: timer.finish(),
          rangeLabel: timer.target.rangeLabel,
          source: 'timer',
          taskLocator: { sourceId: timer.target.sourceId, range: timer.target.range, type: timer.target.type },
        }}
        onDone={timer.confirmRecordSaved}
      />
    );
  }

  if (!timer.target) return null;

  const subject = state.subjects.find((s) => s.id === timer.target?.subjectId);
  const task = timer.target.taskId ? state.tasks.find((t) => t.id === timer.target?.taskId) : undefined;

  const handleFinish = () => {
    const target = timer.target;
    if (!target) return;
    timer.finish();
    stopNoise();
    setConfirmDiscard(false);
    setControlsOpen(false);
    setMinimized(false);
    setRecordDismissed(false);
  };

  const handleDiscard = () => {
    stopNoise();
    setConfirmDiscard(false);
    setControlsOpen(false);
    setMinimized(false);
    timer.discard();
  };

  const remainingSec = timer.phaseDurationSec !== null ? Math.max(0, timer.phaseDurationSec - timer.phaseElapsedSec) : 0;
  const phaseLabel = timer.phase === 'work' ? '集中' : timer.phase === 'break' ? '休憩' : '長い休憩';
  const cyclesUntilLong = timer.pomodoro.cyclesUntilLongBreak;
  const displaySec = timer.mode === 'pomodoro' ? remainingSec : timer.phaseElapsedSec;
  const phaseProgress = timer.phaseDurationSec
    ? Math.min(1, Math.max(0, timer.phaseElapsedSec / timer.phaseDurationSec))
    : null;
  const dialStyle = phaseProgress === null
    ? undefined
    : ({ '--timer-progress': `${phaseProgress * 360}deg` } as CSSProperties);

  if (minimized) {
    return createPortal(
      <button
        type="button"
        className={`timer-mini ${isBreak ? 'break' : ''}`}
        onClick={() => setMinimized(false)}
        aria-label={`${timer.pendingRecord ? '保存待ちの学習記録' : `${phaseLabel}タイマー ${formatHM(displaySec)}`}を開く`}
      >
        <span className={`timer-mini-indicator ${timer.running ? 'running' : ''}`} aria-hidden="true" />
        <span className="timer-mini-copy">
          <strong>{timer.pendingRecord ? '学習記録を保存' : timer.target.title}</strong>
          <span>{timer.pendingRecord ? '時間と教材の情報が残っています' : `${phaseLabel}${timer.running ? '' : '・一時停止中'}`}</span>
        </span>
        {!timer.pendingRecord && <span className="timer-mini-clock" aria-hidden="true">{formatHM(displaySec)}</span>}
        <Maximize2 size={17} strokeWidth={2.2} aria-hidden="true" />
      </button>,
      document.body,
    );
  }

  return createPortal(
    <>
      <div className="timer-overlay" role="dialog" aria-modal="true" aria-label="学習タイマー" ref={overlayRef} tabIndex={-1}>
        <div className="timer-topbar">
          <button type="button" className="timer-icon-button" onClick={() => setMinimized(true)} aria-label="タイマーを最小化">
            <Minimize2 size={20} strokeWidth={2.1} aria-hidden="true" />
          </button>
          <div className="timer-topbar-copy">
            <strong>{isBreak ? phaseLabel : 'フォーカス中'}</strong>
            <span>{timer.mode === 'pomodoro' ? 'ポモドーロ' : 'ストップウォッチ'}</span>
          </div>
          <button
            type="button"
            className={`timer-icon-button ${noise !== 'off' ? 'active' : ''}`}
            onClick={() => setControlsOpen(true)}
            aria-label={`タイマーのオプションを開く（環境音: ${NOISE_LABEL[noise]}）`}
            aria-expanded={controlsOpen}
          >
            <MoreHorizontal size={21} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>

        {timer.pendingRecord ? (
          <div className="timer-pending-state">
            <span className="timer-pending-icon" aria-hidden="true"><CheckCircle2 size={30} strokeWidth={2.1} /></span>
            <div>
              <h2>学習時間を保存しましょう</h2>
              <p>時間とタスク情報は端末に保存済みです。内容を確認して記録を完了できます。</p>
            </div>
            <button type="button" className="btn btn-primary btn-block" onClick={() => setRecordDismissed(false)}>
              記録内容を確認
            </button>
          </div>
        ) : (
          <>
            <div className="timer-stage">
              <div className="timer-task-context">
                {subject && (
                  <span className="subject-chip" style={{ background: `${subject.color}26`, color: subject.color }}>
                    {subject.name}
                  </span>
                )}
                <h1>{timer.target.title}</h1>
                <p>{timer.target.rangeLabel}</p>
                {task && <span>予定 {task.estimatedMinutes}分</span>}
              </div>

              <div
                className={`timer-dial-shell ${timer.mode === 'stopwatch' ? 'stopwatch' : ''} ${isBreak ? 'break' : ''}`}
                style={dialStyle}
              >
                <div className="timer-dial-inner">
                  <span className="timer-dial-kicker">
                    {timer.mode === 'pomodoro'
                      ? <>{isBreak ? <Coffee size={14} strokeWidth={2.3} aria-hidden="true" /> : '●'} {phaseLabel}</>
                      : '経過時間'}
                  </span>
                  <div className={`timer-clock ${isBreak ? 'timer-clock-break' : ''}`} aria-live="off">
                    {formatHM(displaySec)}
                  </div>
                  <span className="timer-dial-status" aria-live="polite">
                    {timer.running
                      ? timer.mode === 'pomodoro' && timer.phaseDurationSec !== null
                        ? `${Math.round(timer.phaseDurationSec / 60)}分セッション`
                        : '計測中'
                      : '一時停止中'}
                  </span>
                </div>
              </div>

              {timer.mode === 'pomodoro' && (
                <div className="timer-session-meta">
                  <div className="timer-cycles" aria-label={`${timer.cycle}回の集中を完了`}>
                    {Array.from({ length: cyclesUntilLong }, (_, i) => {
                      const posInRound = timer.cycle % cyclesUntilLong;
                      const roundDone = timer.cycle > 0 && posInRound === 0 && timer.phase === 'longBreak';
                      const filled = roundDone ? cyclesUntilLong : posInRound;
                      return <span key={i} className={`timer-cycle-dot ${i < filled ? 'done' : ''}`} aria-hidden="true" />;
                    })}
                    <span>累計 {timer.cycle}回</span>
                  </div>
                  <span>実勉強 {formatHM(timer.workSec)}</span>
                </div>
              )}

              {isBreak && (
                <button type="button" className="timer-skip-action" onClick={timer.skipBreak}>
                  <SkipForward size={15} strokeWidth={2.4} aria-hidden="true" /> 休憩をスキップ
                </button>
              )}

              {noise !== 'off' && (
                <div className="timer-noise-status" aria-label={`環境音: ${NOISE_LABEL[noise]}`}>
                  {noise === 'white'
                    ? <Wind size={14} strokeWidth={2.2} aria-hidden="true" />
                    : <CloudRain size={14} strokeWidth={2.2} aria-hidden="true" />}
                  {NOISE_LABEL[noise]}
                </div>
              )}
            </div>

            <div className="timer-controls">
              {timer.running ? (
                <button type="button" className="timer-control-primary" onClick={timer.pause}>
                  <Pause size={19} strokeWidth={2.5} fill="currentColor" aria-hidden="true" /> 一時停止
                </button>
              ) : (
                <button type="button" className="timer-control-primary" onClick={timer.resume}>
                  <Play size={19} strokeWidth={2.5} fill="currentColor" aria-hidden="true" /> 再開
                </button>
              )}
              <button type="button" className="timer-control-secondary" onClick={handleFinish}>
                <Check size={18} strokeWidth={2.7} aria-hidden="true" /> 終了して記録
              </button>
            </div>
          </>
        )}
      </div>

      <Sheet open={controlsOpen} onClose={() => setControlsOpen(false)} title="タイマーのオプション">
        <div className="timer-option-section">
          <div className="timer-option-heading">
            <strong>タイマーの種類</strong>
            <span>計測済みの勉強時間は引き継がれます</span>
          </div>
          {timer.running ? (
            <div className="timer-option-locked">
              <span>{timer.mode === 'pomodoro' ? '🍅 ポモドーロ' : 'ストップウォッチ'}</span>
              <small>変更するには一度タイマーを停止してください</small>
            </div>
          ) : (
            <Segmented
              ariaLabel="タイマーの種類"
              options={[
                { value: 'stopwatch', label: 'ストップウォッチ' },
                { value: 'pomodoro', label: '🍅 ポモドーロ' },
              ]}
              value={timer.mode}
              onChange={timer.setMode}
            />
          )}
        </div>

        <div className="timer-option-section">
          <div className="timer-option-heading">
            <strong>環境音</strong>
            <span>集中フェーズの計測中だけ再生します</span>
          </div>
          <Segmented
            ariaLabel="環境音"
            options={[
              { value: 'off', label: 'オフ' },
              { value: 'white', label: 'ホワイト' },
              { value: 'rain', label: '雨音' },
            ]}
            value={noise}
            onChange={setNoiseState}
          />
        </div>

        <button
          type="button"
          className="btn btn-danger btn-block"
          onClick={() => {
            setControlsOpen(false);
            setConfirmDiscard(true);
          }}
        >
          <Trash2 size={15} strokeWidth={2.3} aria-hidden="true" /> 記録せずタイマーを破棄
        </button>
      </Sheet>

      <Sheet open={confirmDiscard} onClose={() => setConfirmDiscard(false)} title="タイマーを破棄しますか?">
        <p className="muted">計測した時間は学習記録に保存されません。</p>
        <div className="timer-confirm-actions" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmDiscard(false)}>
            <X size={14} strokeWidth={2.4} aria-hidden="true" /> キャンセル
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={handleDiscard}>
            <Trash2 size={14} strokeWidth={2.4} aria-hidden="true" /> 破棄
          </button>
        </div>
      </Sheet>
    </>,
    document.body,
  );
}
