import { useMemo, useState } from 'react';
import {
  Brain,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Coffee,
  Play,
  RefreshCw,
  Settings,
  SkipForward,
  Sparkles,
  Timer,
  TriangleAlert,
  X,
} from 'lucide-react';
import { QuickStartSheet } from '../components/timer/QuickStartSheet';
import { useApp } from '../state/AppContext';
import { useTimer } from '../components/timer/TimerContext';
import { computeAnalytics } from '../lib/analytics';
import { availableMinutesOn, computeDayStatus, futureFreeSlotsOn, subtractBusySlots, taskBusySlots } from '../lib/scheduler';
import { diffDays, formatDateJa, formatMinutes, minutesToHM, today } from '../lib/date';
import { EmptyState, ProgressBar } from '../components/ui/bits';
import { TaskRow } from '../components/cards/TaskRow';
import { Confetti } from '../components/ui/Confetti';
import { useToast } from '../components/ui/Toast';
import { RecordSheet } from '../components/forms/RecordSheet';
import type { StudyTask } from '../types';

export function plannedTaskCompletionRate(tasks: readonly StudyTask[]): number {
  const planned = tasks.filter((task) => task.status !== 'skipped');
  if (planned.length === 0) return 0;
  return planned.filter((task) => task.status === 'done').length / planned.length;
}

const STATUS_UI = {
  ahead: { label: '余裕を持って進めています', short: '余裕あり', tone: 'ok' },
  onTrack: { label: '今日は順調です', short: '順調', tone: 'ok' },
  slightlyBehind: { label: '少し調整が必要です', short: '要調整', tone: 'warning' },
  danger: { label: '計画の見直しが必要です', short: '要対応', tone: 'critical' },
} as const;

export function TodayScreen({
  onOpenSettings,
  onOpenPlan,
  onOpenMemory,
  memorySetCount = 0,
  hasActiveMemorySession = false,
  memoryWeakCount = 0,
  recentMemorySession,
}: {
  onOpenSettings: () => void;
  onOpenPlan?: () => void;
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
  const [recordTask, setRecordTask] = useState<StudyTask | null>(null);
  const t = today();

  const analytics = useMemo(() => computeAnalytics(state, t), [state, t]);
  const dayStatus = useMemo(() => computeDayStatus(state, t, analytics.capacity), [state, t, analytics.capacity]);
  const todayTasks = useMemo(
    () => state.tasks
      .filter((task) => task.scheduledDate === t && task.placementStatus !== 'conflict' && task.placementStatus !== 'unscheduled')
      .sort((a, b) => {
        if ((a.status === 'done') !== (b.status === 'done')) return a.status === 'done' ? 1 : -1;
        if ((a.status === 'doing') !== (b.status === 'doing')) return a.status === 'doing' ? -1 : 1;
        return (a.scheduledStart ?? '99:99').localeCompare(b.scheduledStart ?? '99:99') || b.priority - a.priority;
      }),
    [state.tasks, t],
  );
  const pending = todayTasks.filter((task) => task.status === 'planned' || task.status === 'doing' || task.status === 'postponed');
  const overdue = useMemo(
    () => state.tasks
      .filter((task) => task.status === 'planned' && task.scheduledDate < t)
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || b.priority - a.priority)
      .slice(0, 5),
    [state.tasks, t],
  );

  const topTask = pending[0] ?? null;
  const topSubject = topTask ? state.subjects.find((subject) => subject.id === topTask.subjectId) : null;
  const remainingTasks = todayTasks.filter((task) => task.id !== topTask?.id);
  const plannedMinutes = todayTasks.filter((task) => task.status !== 'skipped').reduce((sum, task) => sum + task.estimatedMinutes, 0);
  const remainingMinutes = pending.reduce((sum, task) => sum + task.estimatedMinutes, 0);
  const doneRate = plannedTaskCompletionRate(todayTasks);
  const daysLeft = state.goal ? diffDays(t, state.goal.examDate) : null;
  const allDoneToday = plannedMinutes > 0 && pending.length === 0;
  const todayBudget = availableMinutesOn(state, t);
  const todaySlots = subtractBusySlots(
    futureFreeSlotsOn(state, t, new Date()),
    taskBusySlots(todayTasks.filter((task) => task.status !== 'done')),
  );
  const additionalMinutesNeeded = state.lastScheduleResult?.progressDeficits.reduce((sum, item) => sum + item.minutes, 0) ?? 0;
  const conflictCount = state.tasks.filter((task) => task.scheduledDate === t && task.placementStatus === 'conflict').length;
  const unscheduledCount = state.lastScheduleResult?.unscheduledWork.length ?? 0;
  const status = STATUS_UI[dayStatus];
  const hasPlanWarning = !analytics.capacity.ok || conflictCount > 0 || unscheduledCount > 0;

  const startTask = (task: StudyTask) => {
    const started = timer.start({
      taskId: task.id,
      subjectId: task.subjectId,
      materialId: task.materialId,
      title: task.title,
      rangeLabel: task.rangeLabel,
      sourceId: task.sourceId,
      range: task.materialRange ?? (Number.isFinite(task.rangeStart) && Number.isFinite(task.rangeEnd)
        ? { start: task.rangeStart!, end: task.rangeEnd! }
        : undefined),
      type: task.type,
    });
    if (!started) toast(`「${timer.target?.title ?? '学習'}」を計測中です。画面下のタイマーから再開できます`);
  };

  const postponeTopTask = (task: StudyTask) => {
    const result = execute({ type: 'POSTPONE_TASK', taskId: task.id });
    toast(result.message ?? 'このタスクを明日以降へ移しました');
  };

  return (
    <div className="screen today-v2">
      <Confetti trigger={celebrate} />

      <header className="today-header">
        <div>
          <div className="today-date">{formatDateJa(t)}</div>
          <h1 className="today-greeting">{status.label}</h1>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button className="icon-btn" aria-label="フリータイマーを開始" onClick={() => setQuickOpen(true)}>
            <Timer size={21} strokeWidth={1.9} aria-hidden="true" />
          </button>
          <button className="icon-btn" aria-label="設定を開く" onClick={onOpenSettings}>
            <Settings size={21} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="today-command-layout">
        <main className="today-command-main">
          {topTask && topSubject ? (
            <section className="next-action" aria-labelledby="next-action-title">
              <div className="next-action-topline">
                <span className="next-action-eyebrow" id="next-action-title">次にやる</span>
                {topTask.scheduledStart && (
                  <span className="next-action-time"><CalendarClock size={14} aria-hidden="true" />{topTask.scheduledStart}から</span>
                )}
              </div>
              <div className="next-action-subject">
                <span className="subject-dot" style={{ background: topSubject.color }} aria-hidden="true" />
                {topSubject.name}
                {topTask.status === 'doing' && <span className="status-badge status-accent">進行中</span>}
              </div>
              <h2>{topTask.title}</h2>
              <p className="next-action-range">{topTask.rangeLabel}</p>
              <div className="next-action-duration">
                <strong>{topTask.estimatedMinutes}</strong><span>分</span>
              </div>
              <div className="next-action-buttons">
                <button className="btn btn-primary" onClick={() => startTask(topTask)}>
                  <Play size={18} fill="currentColor" aria-hidden="true" />
                  {topTask.status === 'doing' ? '学習を続ける' : '勉強を始める'}
                </button>
                <button className="btn btn-secondary" onClick={() => setRecordTask(topTask)}>
                  <CheckCircle2 size={18} aria-hidden="true" />完了を記録
                </button>
              </div>
              {topTask.status !== 'doing' && (
                <button className="today-rest-action" onClick={() => postponeTopTask(topTask)}>
                  <SkipForward size={16} aria-hidden="true" />明日以降へ
                </button>
              )}
              <div className="next-action-footer">
                <span>今日あと{pending.length}件 · {formatMinutes(remainingMinutes)}</span>
                <span>{Math.round(doneRate * 100)}% 完了</span>
              </div>
              <ProgressBar value={doneRate} color={topSubject.color} />
            </section>
          ) : allDoneToday ? (
            <section className="next-action next-action-complete" aria-labelledby="all-done-title">
              <span className="completion-mark" aria-hidden="true"><CheckCircle2 size={28} /></span>
              <span className="next-action-eyebrow">今日の予定</span>
              <h2 id="all-done-title">すべて完了しました</h2>
              <p>ここまでで十分です。余力があれば、短い復習だけにしておきましょう。</p>
              {onOpenMemory && memorySetCount > 0 ? (
                <button className="btn btn-primary next-action-button" onClick={onOpenMemory}>
                  <Brain size={18} aria-hidden="true" />暗記を10問だけ
                </button>
              ) : (
                <button className="btn btn-primary next-action-button" onClick={() => setQuickOpen(true)}>
                  <Play size={18} fill="currentColor" aria-hidden="true" />フリー学習を始める
                </button>
              )}
              <button className="today-rest-action" onClick={() => toast('今日はここまで。しっかり休みましょう')}>
                <Coffee size={16} aria-hidden="true" />今日は休む
              </button>
            </section>
          ) : (
            <section className="next-action next-action-empty" aria-labelledby="empty-day-title">
              <span className="completion-mark neutral" aria-hidden="true"><Sparkles size={28} /></span>
              <span className="next-action-eyebrow">次にやる</span>
              <h2 id="empty-day-title">今日は予定がありません</h2>
              <p>自由に学習するか、休息日にできます。</p>
              <button className="btn btn-primary next-action-button" onClick={() => setQuickOpen(true)}>
                <Play size={18} fill="currentColor" aria-hidden="true" />フリー学習を始める
              </button>
            </section>
          )}

          {hasPlanWarning && (
            <div className={`status-banner ${!analytics.capacity.ok ? 'critical' : 'warning'}`} role="status">
              <TriangleAlert size={20} aria-hidden="true" />
              <div className="status-banner-copy">
                <strong>{!analytics.capacity.ok ? '期限に間に合わせるため、計画の調整が必要です' : '予定を確認してください'}</strong>
                <span>
                  {!analytics.capacity.ok && `あと${formatMinutes(analytics.capacity.deficitMinutes)}の学習時間が必要です。`}
                  {conflictCount > 0 && ` 同じ時間に予定が${conflictCount}件重なっています。`}
                  {unscheduledCount > 0 && ` 予定に入れられていない学習が${unscheduledCount}件あります。`}
                </span>
              </div>
              {onOpenPlan && (
                <button type="button" className="status-banner-action" onClick={onOpenPlan}>
                  計画を見る <ChevronRight size={15} strokeWidth={2.4} aria-hidden="true" />
                </button>
              )}
            </div>
          )}

          {state.lastReschedule && (
            <div className="status-banner" role="status">
              <RefreshCw size={19} aria-hidden="true" />
              <div className="status-banner-copy">
                <strong>計画を更新しました</strong>
                <span>{state.lastReschedule.summaryText}</span>
              </div>
              <button className="icon-btn" aria-label="通知を閉じる" onClick={() => dispatch({ type: 'DISMISS_RESCHEDULE_BANNER' })}>
                <X size={17} aria-hidden="true" />
              </button>
            </div>
          )}

          {overdue.length > 0 && (
            <section className="today-section" aria-labelledby="overdue-title">
              <div className="today-section-heading">
                <div>
                  <span className="section-kicker">要対応</span>
                  <h2 id="overdue-title">前日までの未完了</h2>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    const result = execute({ type: 'RESCHEDULE', reason: '未達成タスクの整理' });
                    toast(result.message ?? '未完了分を計画へ組み込みました');
                  }}
                >
                  再配置
                </button>
              </div>
              <div className="today-task-stack">
                {overdue.map((task) => <TaskRow key={task.id} task={task} showDate onCelebrate={() => setCelebrate((count) => count + 1)} />)}
              </div>
            </section>
          )}
        </main>

        <aside className="today-command-side" aria-label="今日の予定と学習候補">
          <section className="today-section today-schedule" aria-labelledby="today-schedule-title">
            <div className="today-section-heading">
              <div>
                <span className="section-kicker">スケジュール</span>
                <h2 id="today-schedule-title">今日の残り</h2>
              </div>
              <span className={`plan-state plan-state-${status.tone}`}>{status.short}</span>
            </div>
            {remainingTasks.length === 0 ? (
              <div className="today-quiet-empty">ほかの予定はありません</div>
            ) : (
              <div className="today-task-stack">
                {remainingTasks.map((task) => <TaskRow key={task.id} task={task} onCelebrate={() => setCelebrate((count) => count + 1)} />)}
              </div>
            )}
          </section>

          {onOpenMemory && (
            <section className="today-section" aria-labelledby="memory-candidate-title">
              <div className="today-section-heading">
                <div>
                  <span className="section-kicker">3分でできる</span>
                  <h2 id="memory-candidate-title">短い学習</h2>
                </div>
              </div>
              <button type="button" className="list-surface today-memory-candidate" onClick={onOpenMemory}>
                <span className="memory-candidate-icon"><Brain size={20} aria-hidden="true" /></span>
                <span className="list-row-main">
                  <strong>{hasActiveMemorySession ? '暗記の続きをする' : '暗記カードを10問'}</strong>
                  <small>
                    {memorySetCount > 0
                      ? `苦手 ${memoryWeakCount}問を優先${recentMemorySession ? ` · 前回${recentMemorySession.answerCount}問` : ''}`
                      : 'セットを作ると、すぐ始められます'}
                  </small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </section>
          )}

          <details className="quiet-disclosure today-plan-details" open={hasPlanWarning}>
            <summary><CircleHelp size={15} aria-hidden="true" /> 計画の状態を詳しく見る</summary>
            <dl>
              <div><dt>今日の予定</dt><dd>{formatMinutes(plannedMinutes)}</dd></div>
              <div><dt>確保できる時間</dt><dd>{formatMinutes(todayBudget)}</dd></div>
              <div><dt>追加で必要</dt><dd>{additionalMinutesNeeded > 0 ? formatMinutes(additionalMinutesNeeded) : 'なし'}</dd></div>
              <div><dt>予定に入らない学習</dt><dd>{unscheduledCount}件</dd></div>
              <div className="wide">
                <dt>これからの空き時間</dt>
                <dd>{todaySlots.map((slot) => `${minutesToHM(slot.start)}〜${minutesToHM(slot.end)}`).join(' / ') || 'なし'}</dd>
              </div>
              {daysLeft !== null && <div className="wide"><dt>{state.goal?.name}まで</dt><dd>{daysLeft}日</dd></div>}
            </dl>
          </details>
        </aside>
      </div>

      {todayTasks.length === 0 && state.materials.length === 0 && (
        <EmptyState icon="📚" title="最初の教材を追加しましょう">
          教材を追加すると、期限から逆算して今日やることを作ります。
        </EmptyState>
      )}

      {quickOpen && <QuickStartSheet open onClose={() => setQuickOpen(false)} />}
      {recordTask && (
        <RecordSheet
          open
          onClose={() => setRecordTask(null)}
          preset={{
            taskId: recordTask.id,
            subjectId: recordTask.subjectId,
            materialId: recordTask.materialId,
            minutes: recordTask.estimatedMinutes,
            rangeLabel: `${recordTask.title} ${recordTask.rangeLabel}`,
            source: 'manual',
            taskLocator: {
              sourceId: recordTask.sourceId,
              range: recordTask.materialRange ?? (Number.isFinite(recordTask.rangeStart) && Number.isFinite(recordTask.rangeEnd)
                ? { start: recordTask.rangeStart!, end: recordTask.rangeEnd! }
                : undefined),
              type: recordTask.type,
            },
          }}
          onDone={() => setCelebrate((count) => count + 1)}
        />
      )}
    </div>
  );
}
