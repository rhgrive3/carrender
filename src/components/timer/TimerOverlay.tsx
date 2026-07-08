import { useState } from 'react';
import { Check, Pause, Play } from 'lucide-react';
import { useTimer, type TimerTarget } from './TimerContext';
import { useApp } from '../../state/AppContext';
import { formatHM } from '../../lib/date';
import { RecordSheet } from '../forms/RecordSheet';

/** 集中モードの全画面タイマー + 終了後の記録フロー */
export function TimerOverlay() {
  const timer = useTimer();
  const { state } = useApp();
  // 終了時はtimer.targetが消えるため、記録用にスナップショットを保持する
  const [finished, setFinished] = useState<{ target: TimerTarget; minutes: number } | null>(null);

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
    setFinished({ target, minutes });
  };

  return (
    <div className="timer-overlay" role="dialog" aria-label="学習タイマー">
      <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            if (window.confirm('タイマーを破棄しますか?記録は保存されません。')) timer.discard();
          }}
        >
          破棄
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 26, width: '100%' }}>
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

        <div className={`timer-clock ${timer.running ? 'timer-pulse' : ''}`} aria-live="off">
          {formatHM(timer.elapsedSec)}
        </div>

        {!timer.running && <span className="status-badge status-warn">一時停止中</span>}
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
