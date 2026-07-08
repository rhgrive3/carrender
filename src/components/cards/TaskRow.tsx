import { useState } from 'react';
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
  const { state, dispatch } = useApp();
  const timer = useTimer();
  const toast = useToast();
  const [recordOpen, setRecordOpen] = useState(false);

  const subject = state.subjects.find((s) => s.id === task.subjectId);
  const isDone = task.status === 'done';

  const startTimer = () => {
    timer.start({
      taskId: task.id,
      subjectId: task.subjectId,
      materialId: task.materialId,
      title: task.title,
      rangeLabel: task.rangeLabel,
    });
  };

  const postpone = () => {
    dispatch({ type: 'POSTPONE_TASK', taskId: task.id });
    toast('明日以降に再配置しました');
  };

  return (
    <>
      <div className={`task-card ${isDone ? 'done' : ''}`}>
        <div className="subject-bar" style={{ background: subject?.color ?? 'var(--accent)' }} />
        <div className="task-main">
          <div className="task-meta-row">
            <SubjectChip subject={subject} />
            <TaskTypeChip type={task.type} />
            {showDate && <span className="task-time">{task.scheduledDate.slice(5).replace('-', '/')}</span>}
          </div>
          <div className="task-title">{task.title}</div>
          <div className="task-range">
            {task.rangeLabel}
            <span className="task-time"> ・{task.estimatedMinutes}分</span>
            {task.scheduledStart && <span className="task-time"> ・{task.scheduledStart}〜</span>}
          </div>
        </div>
        {!isDone && (
          <div className="task-actions">
            <button className="task-action-btn" aria-label={`${task.title}を延期`} onClick={postpone} title="延期">
              ⏭
            </button>
            <button className="task-action-btn" aria-label={`${task.title}を完了として記録`} onClick={() => setRecordOpen(true)} title="完了">
              ✓
            </button>
            <button className="task-action-btn primary" aria-label={`${task.title}のタイマーを開始`} onClick={startTimer} title="開始">
              ▶
            </button>
          </div>
        )}
        {isDone && <span style={{ fontSize: 20 }} aria-label="完了済み">✅</span>}
      </div>

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
