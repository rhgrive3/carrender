import { useId, useState } from 'react';
import { Check, CircleCheck, Play, SkipForward, Unlock } from 'lucide-react';
import type { StudyTask } from '../../types';
import { useApp } from '../../state/AppContext';
import { useTimer } from '../timer/TimerContext';
import { SubjectChip, TaskTypeChip } from '../ui/bits';
import { RecordSheet } from '../forms/RecordSheet';
import { useToast } from '../ui/Toast';

interface TaskRowProps {
  task: StudyTask;
  onCelebrate?: () => void;
  showDate?: boolean;
}

/** タスク1行: 開始 / 完了 / 延期 が3タップ以内で完結する */
export function TaskRow({ task, onCelebrate, showDate }: TaskRowProps) {
  const { state, dispatch, execute } = useApp();
  const timer = useTimer();
  const toast = useToast();
  const [recordOpen, setRecordOpen] = useState(false);
  const titleId = useId();
  const detailsId = useId();
  const statusId = useId();

  const subject = state.subjects.find((s) => s.id === task.subjectId);
  const isDone = task.status === 'done';
  const isDoing = task.status === 'doing';
  const lock = task.placementLock ?? (task.generatedBy === 'manual' ? (task.scheduledStart ? 'time' : 'date') : 'none');

  const startTimer = () => {
    const started = timer.start({
      taskId: task.id,
      subjectId: task.subjectId,
      materialId: task.materialId,
      title: task.title,
      rangeLabel: task.rangeLabel,
      sourceId: task.sourceId,
      range: task.materialRange ?? (Number.isFinite(task.rangeStart) && Number.isFinite(task.rangeEnd) ? { start: task.rangeStart!, end: task.rangeEnd! } : undefined),
      type: task.type,
    });
    if (!started) toast(`「${timer.target?.title ?? '学習'}」を計測中です。画面下のタイマーから再開できます`);
  };

  const postpone = () => {
    if (isDoing) {
      toast('計測中のタスクは延期できません。タイマーを終了してから操作してください');
      return;
    }
    const result = execute({ type: 'POSTPONE_TASK', taskId: task.id });
    toast(result.message ?? '明日以降に再配置しました');
  };

  return (
    <>
      <article
        className={`task-card ${isDone ? 'done' : ''}`}
        aria-labelledby={titleId}
        aria-describedby={`${detailsId} ${statusId}`}
      >
        <div className="subject-bar" style={{ background: subject?.color ?? 'var(--accent)' }} aria-hidden="true" />
        <div className="task-main">
          <div className="task-meta-row">
            <SubjectChip subject={subject} />
            <TaskTypeChip type={task.type} />
            <span className="task-time">{lock === 'time' ? '時刻固定' : lock === 'date' ? '日付固定' : '自動'}</span>
            {isDoing && <span className="status-badge status-accent">進行中</span>}
            {showDate && (
              <time className="task-time" dateTime={task.scheduledDate}>
                {task.scheduledDate.slice(5).replace('-', '/')}
              </time>
            )}
          </div>
          <div className="task-title" id={titleId} role="heading" aria-level={3}>{task.title}</div>
          <div className="task-range" id={detailsId}>
            {task.rangeLabel}
            <span className="task-time"> ・{task.estimatedMinutes}分</span>
            {task.scheduledStart && <span className="task-time"> ・{task.scheduledStart}〜</span>}
          </div>
          <span className="sr-only" id={statusId}>{isDone ? '完了済み' : isDoing ? '計測中' : '未完了'}</span>
        </div>
        {!isDone && (
          <div className="task-actions" role="group" aria-label={`${task.title}の操作`}>
            {!isDoing && lock !== 'none' && (
              <button type="button" className="task-action-btn" aria-label={`${task.title}のロックを解除`} onClick={() => dispatch({ type: 'UNLOCK_TASK', taskId: task.id })}>
                <span className="ta-icon" aria-hidden="true"><Unlock size={15} strokeWidth={2.4} /></span>
                <span className="ta-label">解除</span>
              </button>
            )}
            {!isDoing && (
              <button type="button" className="task-action-btn" aria-label={`${task.title}を延期`} onClick={postpone}>
                <span className="ta-icon" aria-hidden="true"><SkipForward size={15} strokeWidth={2.4} /></span>
                <span className="ta-label">延期</span>
              </button>
            )}
            <button type="button" className="task-action-btn" aria-label={`${task.title}を完了として記録`} onClick={() => setRecordOpen(true)}>
              <span className="ta-icon" aria-hidden="true"><Check size={15} strokeWidth={2.8} /></span>
              <span className="ta-label">完了</span>
            </button>
            <button type="button" className="task-action-btn primary" aria-label={`${task.title}のタイマーを${isDoing ? '再開' : '開始'}`} onClick={startTimer}>
              <span className="ta-icon" aria-hidden="true"><Play size={15} strokeWidth={2.4} fill="currentColor" /></span>
              <span className="ta-label">{isDoing ? '続ける' : '開始'}</span>
            </button>
          </div>
        )}
        {isDone && <CircleCheck size={22} strokeWidth={2.2} aria-hidden="true" style={{ color: 'var(--ok)', flexShrink: 0 }} />}
      </article>

      {recordOpen && (
        <RecordSheet
          open={recordOpen}
          onClose={() => setRecordOpen(false)}
          preset={{
            taskId: task.id,
            subjectId: task.subjectId,
            materialId: task.materialId,
            minutes: task.estimatedMinutes,
            rangeLabel: `${task.title} ${task.rangeLabel}`,
            source: 'manual',
          }}
          onDone={onCelebrate}
        />
      )}
    </>
  );
}
