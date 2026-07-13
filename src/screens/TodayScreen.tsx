import { useMemo, useState } from 'react';
import { Brain, Lightbulb, Play, RefreshCw, Settings, Timer, TriangleAlert, X } from 'lucide-react';
import { QuickStartSheet } from '../components/timer/QuickStartSheet';
import { useApp } from '../state/AppContext';
import { useTimer } from '../components/timer/TimerContext';
import { computeAnalytics } from '../lib/analytics';
import { availableMinutesOn, computeDayStatus, futureFreeSlotsOn, subtractBusySlots, taskBusySlots } from '../lib/scheduler';
import { diffDays, formatDateJa, formatMinutes, minutesToHM, today } from '../lib/date';
import { ProgressRing } from '../components/ui/ProgressRing';
import { SubjectChip, TaskTypeChip, EmptyState } from '../components/ui/bits';
import { TaskRow } from '../components/cards/TaskRow';
import { Confetti } from '../components/ui/Confetti';
import { useToast } from '../components/ui/Toast';
import type { StudyTask } from '../types';


export function plannedTaskCompletionRate(tasks: readonly StudyTask[]): number {
  const planned = tasks.filter((task) => task.status !== 'skipped');
  if (planned.length === 0) return 0;
  return planned.filter((task) => task.status === 'done').length / planned.length;
}

const STATUS_UI = {
  ahead: { label: '余裕あり', cls: 'status-ok', icon: '🚀' },
  onTrack: { label: '順調', cls: 'status-ok', icon: '✨' },
  slightlyBehind: { label: '少し遅れ', cls: 'status-warn', icon: '⚡' },
  danger: { label: '危険', cls: 'status-danger', icon: '🔥' },
} as const;

export function TodayScreen({
  onOpenSettings,
  onOpenMemory,
  memorySetCount = 0,
  hasActiveMemorySession = false,
  memoryWeakCount = 0,
  recentMemorySession,
}: {
  onOpenSettings: () => void;
  onOpenMemory?: () => void;
  memorySetCount?: number;
  hasActiveMemorySession?: boolean;
  memoryWeakCount?: number;
  recentMemorySession?: { answerCount: number; needsReviewCount: number };
}) {
  const { state, dispatch, execute } = useApp();
  const timer = useTimer();
  const toast = useToast();
  const [celebrate, setCelebrate] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const t = today();

  const analytics = useMemo(() => computeAnalytics(state, t), [state, t]);
  // computeAnalytics内で計算済みのキャパシティを渡して二重計算を避ける
  const dayStatus = useMemo(() => computeDayStatus(state, t, analytics.capacity), [state, t, analytics.capacity]);

  const todayTasks = useMemo(
    () =>
      state.tasks
        .filter((x) => x.scheduledDate === t && x.placementStatus !== 'conflict' && x.placementStatus !== 'unscheduled')
        .sort((a, b) => {
          if ((a.status === 'done') !== (b.status === 'done')) return a.status === 'done' ? 1 : -1;
          return (a.scheduledStart ?? '99').localeCompare(b.scheduledStart ?? '99') || b.priority - a.priority;
        }),
    [state.tasks, t],
  );
  const pending = todayTasks.filter((x) => x.status === 'planned' || x.status === 'doing' || x.status === 'postponed');
  const overdue = useMemo(
    () =>
      state.tasks
        .filter((x) => x.status === 'planned' && x.scheduledDate < t)
        .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || b.priority - a.priority)
        .slice(0, 5),
    [state.tasks, t],
  );

  const topTask = [...pending].sort((a, b) => b.priority - a.priority)[0] ?? null;
  const plannedMinutes = todayTasks.filter((x) => x.status !== 'skipped').reduce((s, x) => s + x.estimatedMinutes, 0);
  const doneRate = plannedTaskCompletionRate(todayTasks);
  const daysLeft = state.goal ? diffDays(t, state.goal.examDate) : null;
  const su = STATUS_UI[dayStatus];
  const topSubject = topTask ? state.subjects.find((s) => s.id === topTask.subjectId) : null;
  const allDoneToday = plannedMinutes > 0 && pending.length === 0;
  const todayBudget = availableMinutesOn(state, t);
  const remainingBudget = Math.max(0, todayBudget - plannedMinutes);
  const todaySlots = subtractBusySlots(futureFreeSlotsOn(state, t, new Date()), taskBusySlots(todayTasks.filter((task) => task.status !== 'done')));
  const progressDebt = state.lastScheduleResult?.progressDeficits.reduce((sum, item) => sum + item.minutes, 0) ?? 0;
  const conflictCount = state.tasks.filter((task) => task.scheduledDate === t && task.placementStatus === 'conflict').length;
  const unscheduledCount = state.lastScheduleResult?.unscheduledWork.length ?? 0;

  return (
    <div className="screen">
      <Confetti trigger={celebrate} />

      <div className="screen-header">
        <div>
          <div className="screen-title">今日</div>
          <div className="screen-sub">{formatDateJa(t)}</div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="icon-btn" aria-label="フリータイマーを開始" onClick={() => setQuickOpen(true)}>
            <Timer size={21} strokeWidth={1.9} aria-hidden="true" />
          </button>
          <button className="icon-btn" aria-label="設定を開く" onClick={onOpenSettings}>
            <Settings size={21} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>
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
            <ProgressRing value={doneRate} label={`${Math.round(doneRate * 100)}%`} sublabel="予定完了" />
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

      <div className="card mt-12" style={{ padding: 13 }}>
        <div className="material-metrics">
          <span><i>残り予算</i><b>{formatMinutes(remainingBudget)}</b></span>
          <span><i>進捗負債</i><b>{formatMinutes(progressDebt)}</b></span>
          <span><i>未配置</i><b>{unscheduledCount}件</b></span>
        </div>
        <div className="faint mt-8">空き区間 {todaySlots.map((slot) => `${minutesToHM(slot.start)}〜${minutesToHM(slot.end)}`).join(' / ') || 'なし'}</div>
        {conflictCount > 0 && <div className="faint mt-8" style={{ color: 'var(--danger)' }}>固定条件の衝突 {conflictCount}件</div>}
      </div>

      {onOpenMemory && (
        <button type="button" className="card today-memory-shortcut mt-12" onClick={onOpenMemory} aria-label="暗記カード学習を開く">
          <Brain size={22} aria-hidden="true" />
          <span>
            <b>{hasActiveMemorySession ? '暗記学習を続ける' : '暗記カードを学習'}</b>
            <small>{memorySetCount > 0 ? `${memorySetCount}セット・苦手 ${memoryWeakCount}項目・オフライン対応` : 'セットを作成してすぐ始められます'}</small>
            {recentMemorySession && <small>直近：回答 {recentMemorySession.answerCount}回・要確認 {recentMemorySession.needsReviewCount}項目</small>}
          </span>
          <Play size={18} fill="currentColor" aria-hidden="true" />
        </button>
      )}

      {/* 再スケジュール通知 */}
      {state.lastReschedule && (
        <div className="card mt-12" style={{ borderColor: 'var(--accent)', background: 'var(--accent-soft)' }}>
          <div className="row spread">
            <div className="iflex" style={{ fontWeight: 800, fontSize: 13.5 }}>
              <RefreshCw size={14} strokeWidth={2.4} aria-hidden="true" style={{ color: 'var(--accent)' }} />
              計画を再設計しました
            </div>
            <button
              className="btn btn-ghost btn-sm"
              aria-label="通知を閉じる"
              onClick={() => dispatch({ type: 'DISMISS_RESCHEDULE_BANNER' })}
            >
              <X size={16} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>
          <p className="muted" style={{ marginTop: 4, lineHeight: 1.55 }}>{state.lastReschedule.summaryText}</p>
        </div>
      )}

      {/* キャパシティ警告 */}
      {!analytics.capacity.ok && (
        <div className="card mt-12" style={{ borderColor: 'var(--danger)' }}>
          <div className="iflex" style={{ fontWeight: 800, fontSize: 13.5, color: 'var(--danger)' }}>
            <TriangleAlert size={14} strokeWidth={2.4} aria-hidden="true" />
            時間が不足しています
          </div>
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
                    sourceId: topTask.sourceId,
                    range: topTask.materialRange ?? (Number.isFinite(topTask.rangeStart) && Number.isFinite(topTask.rangeEnd) ? { start: topTask.rangeStart!, end: topTask.rangeEnd! } : undefined),
                    type: topTask.type,
                  })
                }
              >
                <Play size={15} strokeWidth={2.4} fill="currentColor" aria-hidden="true" /> 今すぐ開始
              </button>
              <button
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={() => {
                  const result = execute({ type: 'POSTPONE_TASK', taskId: topTask.id });
                  toast(result.message ?? '明日以降に再配置しました');
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
          <button className="btn btn-secondary btn-sm mt-16" onClick={() => setQuickOpen(true)}>
            <Play size={14} strokeWidth={2.4} fill="currentColor" aria-hidden="true" /> もっと勉強する(フリータイマー)
          </button>
        </div>
      )}
        </div>

        <div className="today-side">

      {/* 未達成(過去分) */}
      {overdue.length > 0 && (
        <>
          <div className="section-label">
            <span className="iflex">
              <TriangleAlert size={14} strokeWidth={2.4} aria-hidden="true" style={{ color: 'var(--warn)' }} />
              未達成のタスク
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const result = execute({ type: 'RESCHEDULE', reason: '未達成タスクの整理' });
                toast(result.message ?? '未達成分を組み込んで再計算しました');
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

      {/* 今日の一言分析 */}
      {analytics.comments.length > 0 && (
        <>
          <div className="section-label">
            <span className="iflex">
              <Lightbulb size={14} strokeWidth={2.4} aria-hidden="true" style={{ color: 'var(--warn)' }} />
              今日の一言
            </span>
          </div>
          <div className="card">
            <p style={{ fontSize: 14, lineHeight: 1.65 }}>{analytics.comments[0]}</p>
          </div>
        </>
      )}
        </div>
      </div>

      {quickOpen && <QuickStartSheet open onClose={() => setQuickOpen(false)} />}
    </div>
  );
}
