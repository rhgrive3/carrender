import { useMemo, useState } from 'react';
import { useApp } from '../state/AppContext';
import { useTimer } from '../components/timer/TimerContext';
import { computeAnalytics } from '../lib/analytics';
import { computeDayStatus } from '../lib/scheduler';
import { dueReviews } from '../lib/review';
import { diffDays, formatDateJa, formatMinutes, today } from '../lib/date';
import { ProgressRing } from '../components/ui/ProgressRing';
import { SubjectChip, TaskTypeChip, EmptyState } from '../components/ui/bits';
import { TaskRow } from '../components/cards/TaskRow';
import { Confetti } from '../components/ui/Confetti';
import { useToast } from '../components/ui/Toast';

const STATUS_UI = {
  ahead: { label: '余裕あり', cls: 'status-ok', icon: '🚀' },
  onTrack: { label: '順調', cls: 'status-ok', icon: '✨' },
  slightlyBehind: { label: '少し遅れ', cls: 'status-warn', icon: '⚡' },
  danger: { label: '危険', cls: 'status-danger', icon: '🔥' },
} as const;

export function TodayScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { state, dispatch } = useApp();
  const timer = useTimer();
  const toast = useToast();
  const [celebrate, setCelebrate] = useState(0);
  const t = today();

  const analytics = useMemo(() => computeAnalytics(state, t), [state, t]);
  const dayStatus = useMemo(() => computeDayStatus(state, t), [state, t]);
  const reviews = useMemo(() => dueReviews(state, t), [state, t]);

  const todayTasks = useMemo(
    () =>
      state.tasks
        .filter((x) => x.scheduledDate === t)
        .sort((a, b) => {
          if ((a.status === 'done') !== (b.status === 'done')) return a.status === 'done' ? 1 : -1;
          return (a.scheduledStart ?? '99').localeCompare(b.scheduledStart ?? '99') || b.priority - a.priority;
        }),
    [state.tasks, t],
  );
  const pending = todayTasks.filter((x) => x.status === 'planned' || x.status === 'doing' || x.status === 'postponed');
  const overdue = useMemo(
    () => state.tasks.filter((x) => x.status === 'planned' && x.scheduledDate < t).slice(0, 5),
    [state.tasks, t],
  );

  const topTask = pending.sort((a, b) => b.priority - a.priority)[0] ?? null;
  const plannedMinutes = todayTasks.filter((x) => x.status !== 'skipped').reduce((s, x) => s + x.estimatedMinutes, 0);
  const doneRate = plannedMinutes > 0 ? Math.min(1, analytics.todayMinutes / plannedMinutes) : analytics.todayMinutes > 0 ? 1 : 0;
  const daysLeft = state.goal ? diffDays(t, state.goal.examDate) : null;
  const su = STATUS_UI[dayStatus];
  const topSubject = topTask ? state.subjects.find((s) => s.id === topTask.subjectId) : null;
  const allDoneToday = plannedMinutes > 0 && pending.length === 0;

  return (
    <div className="screen">
      <Confetti trigger={celebrate} />

      <div className="screen-header">
        <div>
          <div className="screen-title">今日</div>
          <div className="screen-sub">{formatDateJa(t)}</div>
        </div>
        <button className="icon-btn" aria-label="設定を開く" onClick={onOpenSettings}>
          ⚙️
        </button>
      </div>

      <div className="today-layout">
        <div className="today-main">
      {/* ヒーロー */}
      <div className="hero-card">
        <div className="hero-topline">
          <span className={`status-badge ${su.cls}`}>
            {su.icon} {su.label}
          </span>
          {daysLeft !== null && (
            <span className="countdown-chip">
              {state.goal?.name} まで {daysLeft}日
            </span>
          )}
        </div>
        <div className="hero-stats">
          <div className="hero-ring">
            <ProgressRing value={doneRate} label={`${Math.round(doneRate * 100)}%`} sublabel="達成率" />
          </div>
          <div className="hero-numbers">
            <div className="stat-block">
              <div className="stat-value">{formatMinutes(plannedMinutes)}</div>
              <div className="stat-label">今日の予定</div>
            </div>
            <div className="stat-block">
              <div className="stat-value">{formatMinutes(analytics.todayMinutes)}</div>
              <div className="stat-label">実績</div>
            </div>
            <div className="stat-block">
              <div className="stat-value">🔥 {analytics.streakDays}日</div>
              <div className="stat-label">連続学習</div>
            </div>
            <div className="stat-block">
              <div className="stat-value">{pending.length}件</div>
              <div className="stat-label">残りタスク</div>
            </div>
          </div>
        </div>
      </div>

      {/* 再スケジュール通知 */}
      {state.lastReschedule && (
        <div className="card mt-12" style={{ borderColor: 'var(--accent)', background: 'var(--accent-soft)' }}>
          <div className="row spread">
            <div style={{ fontWeight: 800, fontSize: 13.5 }}>🔄 計画を再設計しました</div>
            <button
              className="btn btn-ghost btn-sm"
              aria-label="通知を閉じる"
              onClick={() => dispatch({ type: 'DISMISS_RESCHEDULE_BANNER' })}
            >
              ✕
            </button>
          </div>
          <p className="muted" style={{ marginTop: 4, lineHeight: 1.55 }}>{state.lastReschedule.summaryText}</p>
        </div>
      )}

      {/* キャパシティ警告 */}
      {!analytics.capacity.ok && (
        <div className="card mt-12" style={{ borderColor: 'var(--danger)' }}>
          <div style={{ fontWeight: 800, fontSize: 13.5, color: 'var(--danger)' }}>⚠️ 時間が不足しています</div>
          <p className="muted" style={{ marginTop: 4, lineHeight: 1.55 }}>
            現在の計画では試験日までに約{formatMinutes(analytics.capacity.deficitMinutes)}不足します。教材の優先度を見直すか、勉強可能時間を増やしてください。
          </p>
        </div>
      )}

      {/* 最優先タスク */}
      {topTask && topSubject && (
        <>
          <div className="section-label">今日の最優先</div>
          <div className="card" style={{ borderColor: topSubject.color, borderWidth: 1.5 }}>
            <div className="task-meta-row">
              <SubjectChip subject={topSubject} />
              <TaskTypeChip type={topTask.type} />
              <span className="status-badge status-accent" style={{ marginLeft: 'auto' }}>優先度 高</span>
            </div>
            <div style={{ fontSize: 17.5, fontWeight: 800, marginTop: 6 }}>{topTask.title}</div>
            <div className="muted" style={{ marginTop: 3 }}>
              {topTask.rangeLabel} ・ 予定 {topTask.estimatedMinutes}分
              {topTask.scheduledStart && ` ・ ${topTask.scheduledStart}〜${topTask.scheduledEnd}`}
            </div>
            <div className="row mt-16">
              <button
                className="btn btn-primary"
                style={{ flex: 2 }}
                onClick={() =>
                  timer.start({
                    taskId: topTask.id,
                    subjectId: topTask.subjectId,
                    materialId: topTask.materialId,
                    title: topTask.title,
                    rangeLabel: topTask.rangeLabel,
                  })
                }
              >
                ▶ 今すぐ開始
              </button>
              <button
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={() => {
                  dispatch({ type: 'POSTPONE_TASK', taskId: topTask.id });
                  toast('明日以降に再配置しました');
                }}
              >
                延期
              </button>
            </div>
          </div>
        </>
      )}

      {allDoneToday && (
        <div className="card mt-12" style={{ textAlign: 'center', padding: 26 }}>
          <div style={{ fontSize: 38 }}>🎉</div>
          <div style={{ fontWeight: 800, fontSize: 17, marginTop: 6 }}>今日の予定をすべて達成!</div>
          <p className="muted mt-8">おつかれさま。明日の計画はもう準備できています。</p>
        </div>
      )}
        </div>

        <div className="today-side">

      {/* 未達成(過去分) */}
      {overdue.length > 0 && (
        <>
          <div className="section-label">
            <span>⚠️ 未達成のタスク</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                dispatch({ type: 'RESCHEDULE', reason: '未達成タスクの整理' });
                toast('未達成分を組み込んで再計算しました');
              }}
            >
              まとめて再配置
            </button>
          </div>
          {overdue.map((task) => (
            <TaskRow key={task.id} task={task} showDate onCelebrate={() => setCelebrate((c) => c + 1)} />
          ))}
        </>
      )}

      {/* 今日のタスク一覧 */}
      <div className="section-label">
        <span>今日のタスク</span>
        <span className="faint">
          {todayTasks.filter((x) => x.status === 'done').length}/{todayTasks.length} 完了
        </span>
      </div>
      {todayTasks.length === 0 ? (
        <EmptyState icon="🌤" title="今日のタスクはありません">
          教材を追加するか、計画画面から再計算してください。
        </EmptyState>
      ) : (
        todayTasks.map((task) => <TaskRow key={task.id} task={task} onCelebrate={() => setCelebrate((c) => c + 1)} />)
      )}

      {/* 復習期限 */}
      {(reviews.overdue.length > 0 || reviews.upcoming.length > 0) && (
        <>
          <div className="section-label">🔁 復習期限</div>
          {[...reviews.overdue, ...reviews.upcoming]
            .filter((x) => x.scheduledDate !== t)
            .slice(0, 4)
            .map((task) => (
              <TaskRow key={task.id} task={task} showDate onCelebrate={() => setCelebrate((c) => c + 1)} />
            ))}
        </>
      )}

      {/* 今日の一言分析 */}
      {analytics.comments.length > 0 && (
        <>
          <div className="section-label">💡 今日の一言</div>
          <div className="card">
            <p style={{ fontSize: 14, lineHeight: 1.65 }}>{analytics.comments[0]}</p>
          </div>
        </>
      )}
        </div>
      </div>
    </div>
  );
}
