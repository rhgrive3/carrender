import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Pin, Play, Plus, RefreshCw, Repeat, SkipForward, Trash2, TriangleAlert } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { addDays, addMonths, formatDateShort, formatMinutes, formatMinutesCompact, formatMinutesTile, hmToMinutes, minutesToHM, monthKeyOf, monthLabel, today, WEEKDAY_LABELS, weekdayOf, genId } from '../lib/date';
import { MonthCalendar } from '../components/ui/MonthCalendar';
import { availableMinutesOn, dayPlanOn, fixedEventsOn, freeSlotsOn } from '../lib/scheduler';
import type { StudyTask } from '../types';
import { Sheet } from '../components/ui/Sheet';
import { Segmented, Stepper, TASK_TYPE_LABEL } from '../components/ui/bits';
import { useToast } from '../components/ui/Toast';
import { useTimer } from '../components/timer/TimerContext';
import { RecordSheet } from '../components/forms/RecordSheet';
import { normalizeTaskSchedule } from '../lib/taskSchedule';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(query).matches));
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export function PlanScreen() {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const t = today();
  const [selected, setSelected] = useState<StudyTask | null>(null);
  const [selectedDay, setSelectedDay] = useState(t);
  const [dayDetailOpen, setDayDetailOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState(t);
  const [view, setView] = useState<'week' | 'month'>('week');
  const [month, setMonth] = useState(() => monthKeyOf(t));
  const widePlan = useMediaQuery('(min-width: 1024px) and (orientation: landscape)');

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(t, i)), [t]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, StudyTask[]>();
    for (const d of days) map.set(d, []);
    for (const task of state.tasks) {
      if (map.has(task.scheduledDate)) map.get(task.scheduledDate)!.push(task);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.scheduledStart ?? '99').localeCompare(b.scheduledStart ?? '99'));
    }
    return map;
  }, [state.tasks, days]);

  const overdueCount = state.tasks.filter((x) => x.status === 'planned' && x.scheduledDate < t).length;

  const openDay = (date: string) => {
    setSelectedDay(date);
    if (!widePlan) setDayDetailOpen(true);
  };

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <div className="screen-title">計画</div>
          <div className="screen-sub">これから1週間の学習ブロック</div>
        </div>
        <button
          className="icon-btn"
          aria-label="手動でタスクを追加"
          onClick={() => {
            setAddDate(selectedDay);
            setAddOpen(true);
          }}
        >
          <Plus size={22} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn btn-secondary btn-sm"
          style={{ flex: 1 }}
          onClick={() => {
            dispatch({ type: 'RESCHEDULE', reason: '今週の再設計' });
            toast('1週間の計画を再設計しました');
          }}
        >
          <RefreshCw size={14} strokeWidth={2.4} aria-hidden="true" /> 今週を再設計
        </button>
        <button
          className="btn btn-secondary btn-sm"
          style={{ flex: 1 }}
          onClick={() => {
            dispatch({ type: 'TODAY_IMPOSSIBLE' });
            toast('今日の分を明日以降へ分散しました');
          }}
        >
          😮‍💨 今日は無理
        </button>
      </div>

      {overdueCount > 0 && (
        <div className="card mt-12" style={{ borderColor: 'var(--warn)', padding: 13 }}>
          <div className="row spread">
            <span className="iflex" style={{ fontSize: 13.5, fontWeight: 700 }}>
              <TriangleAlert size={14} strokeWidth={2.4} aria-hidden="true" style={{ color: 'var(--warn)' }} />
              未達成タスクが{overdueCount}件あります
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                dispatch({ type: 'RESCHEDULE', reason: '未達成タスクの再配置' });
                toast('未達成分を組み込んで再計算しました');
              }}
            >
              再配置
            </button>
          </div>
        </div>
      )}

      <div className="segmented mt-12" role="tablist" aria-label="計画の表示形式">
        <button className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>週(リスト)</button>
        <button className={view === 'month' ? 'active' : ''} onClick={() => { setView('month'); setMonth(monthKeyOf(selectedDay)); }}>月(カレンダー)</button>
      </div>

      <div className="planner-layout mt-16">
        {view === 'month' ? (
          <PlanMonthView month={month} onMonthChange={setMonth} selectedDay={selectedDay} onSelectDay={openDay} />
        ) : (
        <div className="week-grid">
          {days.map((d) => {
            const tasks = tasksByDay.get(d) ?? [];
            const events = fixedEventsOn(state, d);
            const capacity = availableMinutesOn(state, d);
            const planned = tasks.filter((x) => x.status !== 'skipped').reduce((s, x) => s + x.estimatedMinutes, 0);
            const isToday = d === t;
            const selectedCls = selectedDay === d ? 'selected-col' : '';
            return (
              <div key={d} className={`day-column ${isToday ? 'today-col' : ''} ${selectedCls}`}>
                <button className="day-column-header" onClick={() => openDay(d)} aria-label={`${formatDateShort(d)}の日別詳細を開く`}>
                  <span style={{ fontWeight: 800, fontSize: 14.5 }}>
                    {isToday ? '今日' : `${formatDateShort(d)} (${WEEKDAY_LABELS[weekdayOf(d)]})`}
                  </span>
                  <span className="faint">
                    {formatMinutes(planned)} / {formatMinutes(capacity)}
                  </span>
                </button>

                {events.map((ev) => (
                  <div key={ev.id + d} className="mini-block" style={{ opacity: 0.65, cursor: 'default' }}>
                    <Pin size={13} strokeWidth={2.2} aria-hidden="true" style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{ev.title}</span>
                    <span className="faint" style={{ marginLeft: 'auto' }}>
                      {ev.start}〜{ev.end}
                    </span>
                  </div>
                ))}

                {tasks.length === 0 && <div className="faint mt-8">タスクなし ・ 空き{formatMinutes(Math.max(0, capacity - planned))}</div>}

                {tasks.map((task) => {
                  const subject = state.subjects.find((s) => s.id === task.subjectId);
                  const done = task.status === 'done';
                  return (
                    <button
                      key={task.id}
                      className="mini-block"
                      style={{ width: '100%', border: 'none', textAlign: 'left', fontFamily: 'var(--font)', color: 'var(--text)', opacity: done ? 0.5 : 1 }}
                      disabled={done}
                      onClick={() => !done && setSelected(task)}
                      aria-label={done ? `${task.title} ${task.rangeLabel} (完了済み)` : `${task.title} ${task.rangeLabel} を編集`}
                    >
                      <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 4, background: subject?.color, flexShrink: 0 }} />
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {done && <Check size={12} strokeWidth={3} aria-label="完了" style={{ color: 'var(--ok)', verticalAlign: '-0.1em', marginRight: 2 }} />}
                          {task.type === 'review' && <Repeat size={12} strokeWidth={2.6} aria-label="復習" style={{ color: 'var(--accent)', verticalAlign: '-0.1em', marginRight: 2 }} />}
                          {task.type === 'correction' && '✍️ '}
                          {task.title}
                        </span>
                        <span className="faint">{task.rangeLabel}</span>
                      </span>
                      <span className="faint" style={{ flexShrink: 0 }}>
                        {task.scheduledStart ? `${task.scheduledStart}` : ''} {task.estimatedMinutes}分
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        )}

        <aside className="day-detail-dock" aria-label="選択日の詳細">
          <DayDetailPanel
            date={selectedDay}
            onTaskSelect={setSelected}
            onAddTask={(date) => {
              setAddDate(date);
              setAddOpen(true);
            }}
          />
        </aside>
      </div>

      {dayDetailOpen && (
        <Sheet open onClose={() => setDayDetailOpen(false)} title={`${formatDateShort(selectedDay)} の詳細計画`}>
          <DayDetailPanel
            date={selectedDay}
            onTaskSelect={(task) => {
              setDayDetailOpen(false);
              setSelected(task);
            }}
            onAddTask={(date) => {
              setDayDetailOpen(false);
              setAddDate(date);
              setAddOpen(true);
            }}
          />
        </Sheet>
      )}
      {selected && <TaskEditSheet task={selected} onClose={() => setSelected(null)} />}
      {addOpen && <ManualTaskSheet initialDate={addDate} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

// ============================================================
// 月カレンダービュー
// ============================================================

function PlanMonthView({
  month,
  onMonthChange,
  selectedDay,
  onSelectDay,
}: {
  month: string;
  onMonthChange: (month: string) => void;
  selectedDay: string;
  onSelectDay: (date: string) => void;
}) {
  const { state } = useApp();
  const t = today();
  const examDate = state.goal?.examDate ?? null;

  const byDay = useMemo(() => {
    const map = new Map<string, { minutes: number; subjects: string[]; total: number; done: number }>();
    for (const task of state.tasks) {
      if (!task.scheduledDate.startsWith(month) || task.status === 'skipped') continue;
      let e = map.get(task.scheduledDate);
      if (!e) {
        e = { minutes: 0, subjects: [], total: 0, done: 0 };
        map.set(task.scheduledDate, e);
      }
      e.minutes += task.estimatedMinutes;
      e.total += 1;
      if (task.status === 'done') e.done += 1;
      if (!e.subjects.includes(task.subjectId)) e.subjects.push(task.subjectId);
    }
    return map;
  }, [state.tasks, month]);

  const monthPlanned = [...byDay.values()].reduce((s, e) => s + e.minutes, 0);

  return (
    <div className="card" style={{ padding: 13 }}>
      <div className="period-nav" style={{ marginBottom: 10 }}>
        <button aria-label="前の月" onClick={() => onMonthChange(addMonths(month, -1))}>‹</button>
        <b>
          {monthLabel(month)}
          <span className="faint" style={{ fontWeight: 700, marginLeft: 8 }}>予定 {formatMinutes(monthPlanned)}</span>
        </b>
        <div className="row" style={{ gap: 6 }}>
          {month !== monthKeyOf(t) && (
            <button style={{ width: 'auto', padding: '0 10px', fontSize: 12 }} onClick={() => onMonthChange(monthKeyOf(t))}>今月</button>
          )}
          <button aria-label="次の月" onClick={() => onMonthChange(addMonths(month, 1))}>›</button>
        </div>
      </div>
      <MonthCalendar
        month={month}
        selectedDate={selectedDay}
        onSelectDay={onSelectDay}
        renderDay={(d) => {
          const e = byDay.get(d);
          const isExam = d === examDate;
          if (!e && !isExam) return null;
          return (
            <>
              {isExam && <span style={{ fontSize: 10, lineHeight: 1 }} title="試験日">🎯</span>}
              {e && (
                <>
                  <span className="cal-cell-min">
                    {e.total > 0 && e.done === e.total ? '✓' : formatMinutesCompact(e.minutes)}
                  </span>
                  <span className="cal-dots">
                    {e.subjects.slice(0, 3).map((sid) => (
                      <i key={sid} style={{ background: state.subjects.find((s) => s.id === sid)?.color ?? 'var(--accent)' }} />
                    ))}
                  </span>
                </>
              )}
            </>
          );
        }}
      />
      <div className="faint mt-8" style={{ fontSize: 11.5 }}>
        日付をタップすると詳細計画を開きます{examDate ? ' ・ 🎯 = 試験日' : ''}
      </div>
    </div>
  );
}

// ============================================================
// 日別詳細計画
// ============================================================

function DayDetailPanel({
  date,
  onTaskSelect,
  onAddTask,
}: {
  date: string;
  onTaskSelect: (task: StudyTask) => void;
  onAddTask: (date: string) => void;
}) {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const t = today();
  const dayPlan = dayPlanOn(state, date);
  const [memo, setMemo] = useState(dayPlan?.memo ?? '');
  const [load, setLoad] = useState(dayPlan?.load ?? 'normal');

  useEffect(() => {
    setMemo(dayPlan?.memo ?? '');
    setLoad(dayPlan?.load ?? 'normal');
  }, [date, dayPlan?.memo, dayPlan?.load]);

  const tasks = useMemo(
    () =>
      state.tasks
        .filter((task) => task.scheduledDate === date && task.status !== 'skipped')
        .sort((a, b) => (a.scheduledStart ?? '99:99').localeCompare(b.scheduledStart ?? '99:99') || b.priority - a.priority),
    [state.tasks, date],
  );
  const sessions = state.sessions.filter((session) => session.date === date);
  const planned = tasks.reduce((sum, task) => sum + task.estimatedMinutes, 0);
  const actual = sessions.reduce((sum, session) => sum + session.minutes, 0);
  const capacity = availableMinutesOn(state, date);
  const achievement = planned > 0 ? Math.min(1, actual / planned) : actual > 0 ? 1 : 0;
  const free = Math.max(0, capacity - planned);
  const events = fixedEventsOn(state, date);
  const slots = freeSlotsOn(state, date);
  const learningTasks = tasks.filter((task) => task.type === 'new' || task.type === 'pastExam' || task.type === 'mockReview');
  const reviewTasks = tasks.filter((task) => task.type === 'review' || task.type === 'correction');
  const missedTasks = state.tasks.filter((task) => task.status === 'planned' && task.scheduledDate < t);
  const subjectMinutes = new Map<string, number>();
  for (const task of tasks) subjectMinutes.set(task.subjectId, (subjectMinutes.get(task.subjectId) ?? 0) + task.estimatedMinutes);

  const savePlan = (nextLoad = load, shouldReschedule = false) => {
    dispatch({
      type: 'UPDATE_DAY_PLAN',
      dayPlan: {
        date,
        load: nextLoad,
        memo,
        availabilityWindows: dayPlan?.availabilityWindows ?? null,
      },
    });
    if (shouldReschedule) dispatch({ type: 'RESCHEDULE_FROM', fromDate: date, reason: `${formatDateShort(date)}の詳細計画変更` });
  };

  const applyLoad = (nextLoad: typeof load) => {
    setLoad(nextLoad);
    dispatch({
      type: 'UPDATE_DAY_PLAN',
      dayPlan: {
        date,
        load: nextLoad,
        memo,
        availabilityWindows: dayPlan?.availabilityWindows ?? null,
      },
    });
    dispatch({ type: 'RESCHEDULE_FROM', fromDate: date, reason: `${formatDateShort(date)}を${nextLoad === 'light' ? '軽め' : nextLoad === 'heavy' ? '重め' : nextLoad === 'rest' ? '休養日' : '通常'}に変更` });
    toast('日別負荷を反映して再計算しました');
  };

  return (
    <div className="day-detail-panel">
      <div>
        <div style={{ fontWeight: 800, fontSize: 17 }}>
          {date === t ? '今日' : `${formatDateShort(date)} (${WEEKDAY_LABELS[weekdayOf(date)]})`}
        </div>
        <div className="faint">
          空き枠 {slots.map((s) => `${minutesToHM(s.start)}〜${minutesToHM(s.end)}`).join(' / ') || 'なし'}
        </div>
      </div>

      <div className="day-stats mt-12">
        <div><b>{formatMinutesTile(planned)}</b><span>予定</span></div>
        <div><b>{formatMinutesTile(actual)}</b><span>実績</span></div>
        <div><b>{Math.round(achievement * 100)}%</b><span>達成率</span></div>
        <div><b>{formatMinutesTile(free)}</b><span>空き</span></div>
      </div>

      <div className="field mt-12" style={{ marginBottom: 0 }}>
        <label>この日の負荷(変えると自動で再計算)</label>
        <Segmented
          ariaLabel="この日の負荷"
          options={[
            { value: 'normal', label: '通常' },
            { value: 'light', label: '軽め' },
            { value: 'heavy', label: '重め' },
            { value: 'rest', label: '休養' },
          ]}
          value={load}
          onChange={(next) => {
            if (next !== load) applyLoad(next);
          }}
        />
      </div>

      <div className="row mt-12" style={{ gap: 8 }}>
        <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => onAddTask(date)}>
          <Plus size={14} strokeWidth={2.6} aria-hidden="true" /> タスク追加
        </button>
        <button
          className="btn btn-secondary btn-sm"
          style={{ flex: 1 }}
          onClick={() => {
            dispatch({ type: 'RESCHEDULE_FROM', fromDate: date, reason: `${formatDateShort(date)}だけ再計算` });
            toast('この日以降を再計算しました');
          }}
        >
          <RefreshCw size={14} strokeWidth={2.4} aria-hidden="true" /> この日を再計算
        </button>
      </div>

      {events.length > 0 && (
        <>
          <div className="section-label compact">固定予定</div>
          {events.map((event) => (
            <div key={`${event.id}-${date}`} className="mini-block" style={{ cursor: 'default' }}>
              <span style={{ fontWeight: 800 }}>{event.title}</span>
              <span className="faint" style={{ marginLeft: 'auto' }}>{event.start}〜{event.end}</span>
            </div>
          ))}
        </>
      )}

      <TaskListBlock title="学習タスク" tasks={learningTasks} onTaskSelect={onTaskSelect} />
      <TaskListBlock title="復習タスク" tasks={reviewTasks} onTaskSelect={onTaskSelect} />
      {missedTasks.length > 0 && <TaskListBlock title="未達成タスク" tasks={missedTasks.slice(0, 5)} onTaskSelect={onTaskSelect} />}

      <div className="section-label compact">科目別の配分</div>
      {[...subjectMinutes.entries()].length === 0 ? (
        <div className="faint">配分なし</div>
      ) : (
        [...subjectMinutes.entries()].map(([subjectId, minutes]) => {
          const subject = state.subjects.find((s) => s.id === subjectId);
          return (
            <div key={subjectId} className="row" style={{ marginBottom: 8 }}>
              <span
                style={{
                  minWidth: 54,
                  maxWidth: 88,
                  fontSize: 12.5,
                  fontWeight: 800,
                  color: subject?.color,
                  flexShrink: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {subject?.name}
              </span>
              <div style={{ flex: 1, height: 8, background: 'var(--bg-elev3)', borderRadius: 100 }}>
                <div style={{ width: `${planned > 0 ? (minutes / planned) * 100 : 0}%`, height: '100%', borderRadius: 100, background: subject?.color ?? 'var(--accent)' }} />
              </div>
              <span className="faint" style={{ width: 58, textAlign: 'right' }}>{formatMinutes(minutes)}</span>
            </div>
          );
        })
      )}

      <div className="field mt-12">
        <label htmlFor={`day-memo-${date}`}>その日のメモ</label>
        <textarea id={`day-memo-${date}`} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="模試、復習日、体調、気づいたことなど" />
      </div>
      <button
        className="btn btn-secondary btn-sm btn-block"
        onClick={() => {
          savePlan(load, false);
          toast('日別メモを保存しました');
        }}
      >
        メモを保存
      </button>
    </div>
  );
}

function TaskListBlock({ title, tasks, onTaskSelect }: { title: string; tasks: StudyTask[]; onTaskSelect: (task: StudyTask) => void }) {
  const { state, dispatch } = useApp();
  const t = today();
  if (tasks.length === 0) return null;
  return (
    <>
      <div className="section-label compact">{title}</div>
      {tasks.map((task) => {
        const subject = state.subjects.find((s) => s.id === task.subjectId);
        const isDone = task.status === 'done';
        const nextDate = addDays(task.scheduledDate, 1);
        const moveDate = nextDate < t ? t : nextDate;
        const blockedByDueDate = !!task.dueDate && task.dueDate >= t && moveDate > task.dueDate;
        const moveDisabled = isDone || blockedByDueDate;
        return (
          <div key={task.id} className="mini-block task-detail-line">
            <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 4, background: subject?.color, flexShrink: 0 }} />
            <button className="task-line-main" onClick={() => onTaskSelect(task)}>
              <b>{task.title}</b>
              <span>{task.rangeLabel || '詳細なし'} ・ {task.scheduledStart ?? '--:--'}〜{task.scheduledEnd ?? '--:--'} ・ {task.estimatedMinutes}分</span>
            </button>
            <div className="task-line-actions">
              <button className="line-icon-btn" aria-label={`${task.title}を上へ移動`} disabled={isDone} onClick={() => dispatch({ type: 'REORDER_TASK', taskId: task.id, direction: 'up' })}>
                <ChevronUp size={16} strokeWidth={2.2} aria-hidden="true" />
              </button>
              <button className="line-icon-btn" aria-label={`${task.title}を下へ移動`} disabled={isDone} onClick={() => dispatch({ type: 'REORDER_TASK', taskId: task.id, direction: 'down' })}>
                <ChevronDown size={16} strokeWidth={2.2} aria-hidden="true" />
              </button>
              <button
                className="line-icon-btn"
                aria-label={`${task.title}を翌日へ移動`}
                title={blockedByDueDate ? '期限を過ぎるため移動できません' : undefined}
                disabled={moveDisabled}
                onClick={() => dispatch({ type: 'MOVE_TASK', taskId: task.id, date: moveDate })}
              >
                <SkipForward size={15} strokeWidth={2.2} aria-hidden="true" />
              </button>
              <button className="line-icon-btn danger" aria-label={`${task.title}を削除`} onClick={() => dispatch({ type: 'DELETE_TASK', taskId: task.id })}>
                <Trash2 size={15} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}

// ============================================================
// タスク移動・時間変更シート(D&Dの代わりのタップUI)
// ============================================================

function TaskEditSheet({ task, onClose }: { task: StudyTask; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const timer = useTimer();
  const t = today();
  const [minutes, setMinutes] = useState(task.estimatedMinutes);
  const [date, setDate] = useState(task.scheduledDate);
  const [startTime, setStartTime] = useState(task.scheduledStart ?? '');
  const [memo, setMemo] = useState(task.memo ?? '');
  const [recordOpen, setRecordOpen] = useState(false);
  const subject = state.subjects.find((s) => s.id === task.subjectId);
  const material = state.materials.find((m) => m.id === task.materialId);
  const isDone = task.status === 'done';
  const endTime = startTime ? minutesToHM(hmToMinutes(startTime) + minutes) : '';

  const moveTo = (date: string) => {
    if (isDone) {
      toast('完了済みタスクの予定は変更できません');
      return;
    }
    if (task.dueDate && task.dueDate >= t && date > task.dueDate) {
      toast(`期限(${formatDateShort(task.dueDate)})を過ぎる日には移動できません`);
      return;
    }
    dispatch({ type: 'MOVE_TASK', taskId: task.id, date });
    toast(`${formatDateShort(date)}に移動しました`);
    onClose();
  };

  const applyChanges = () => {
    if (isDone) {
      toast('完了済みタスクの予定は変更できません');
      onClose();
      return;
    }

    const normalized = normalizeTaskSchedule(date, startTime, minutes);
    if (task.dueDate && task.dueDate >= t && normalized.date > task.dueDate) {
      toast(`期限(${formatDateShort(task.dueDate)})を過ぎる予定にはできません`);
      return;
    }

    dispatch({
      type: 'UPDATE_TASK',
      task: {
        ...task,
        scheduledDate: normalized.date,
        scheduledStart: normalized.startTime || null,
        scheduledEnd: normalized.endTime || null,
        estimatedMinutes: minutes,
        memo,
        generatedBy: 'manual',
      },
    });
    if (normalized.date !== date || normalized.startTime !== startTime) {
      toast(`${formatDateShort(normalized.date)} ${normalized.startTime}〜に直して保存しました`);
    } else {
      toast('タスクを更新しました');
    }
    onClose();
  };

  return (
    <>
    <Sheet open onClose={onClose} title="タスク詳細">
      <div className="card" style={{ padding: 13, marginBottom: 16 }}>
        <div className="task-meta-row">
          <span className="subject-chip" style={{ background: `${subject?.color}26`, color: subject?.color }}>
            {subject?.name}
          </span>
          <span className="task-type-chip">{TASK_TYPE_LABEL[task.type]}</span>
          <span className="status-badge status-accent">優先度 {Math.round(task.priority)}</span>
        </div>
        <div style={{ fontWeight: 700, marginTop: 4 }}>{task.title}</div>
        <div className="muted">{material ? `教材: ${material.name}` : '教材: 手動タスク'}</div>
        <div className="muted">範囲: {task.rangeLabel || '未設定'}</div>
        <div className="muted">
          予定: {task.scheduledStart ?? '--:--'}〜{task.scheduledEnd ?? '--:--'} ・ {task.estimatedMinutes}分
        </div>
        <div className="muted">期限: {task.dueDate ? formatDateShort(task.dueDate) : 'なし'}</div>
      </div>

      <div className="task-detail-grid">
        <div className="field">
          <label htmlFor="te-date">日付</label>
          <input id="te-date" type="date" value={date} min={t} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="te-start">開始時刻</label>
          <input id="te-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </div>
        <div className="field">
          <label>予定時間</label>
          <Stepper value={minutes} onChange={setMinutes} step={5} min={10} max={240} suffix="分" />
        </div>
        <div className="field">
          <label>終了時刻</label>
          <div className="readonly-field">{endTime || '--:--'}</div>
        </div>
      </div>

      <div className="field">
        <label htmlFor="te-memo">メモまたは詳細</label>
        <textarea id="te-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="注意点、やること、変更理由など" />
      </div>

      <div className="field">
        <label>別の日に移動</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {Array.from({ length: 8 }, (_, i) => addDays(t, i)).map((d) => (
            <button
              key={d}
              className="btn btn-secondary btn-sm"
              style={d === task.scheduledDate ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
              onClick={() => moveTo(d)}
            >
              {d === t ? '今日' : `${formatDateShort(d)}(${WEEKDAY_LABELS[weekdayOf(d)]})`}
            </button>
          ))}
        </div>
      </div>

      <div className="row mt-16">
        <button
          className="btn btn-secondary btn-sm"
          style={{ flex: 1 }}
          disabled={isDone}
          onClick={() => {
            timer.start({
              taskId: task.id,
              subjectId: task.subjectId,
              materialId: task.materialId,
              title: task.title,
              rangeLabel: task.rangeLabel,
            });
            onClose();
          }}
        >
          <Play size={13} strokeWidth={2.4} fill="currentColor" aria-hidden="true" /> 開始
        </button>
        <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} disabled={isDone} onClick={() => setRecordOpen(true)}>
          <Check size={14} strokeWidth={2.8} aria-hidden="true" /> 完了
        </button>
        <button
          className="btn btn-secondary btn-sm"
          style={{ flex: 1 }}
          disabled={isDone}
          onClick={() => {
            dispatch({ type: 'POSTPONE_TASK', taskId: task.id });
            toast('明日以降に再配置しました');
            onClose();
          }}
        >
          <SkipForward size={13} strokeWidth={2.4} aria-hidden="true" /> 延期
        </button>
      </div>
      <button className="btn btn-primary btn-block mt-8" onClick={applyChanges}>
        変更を保存
      </button>
      <button
        className="btn btn-ghost btn-block mt-8"
        style={{ color: 'var(--danger)' }}
        onClick={() => {
          dispatch({ type: 'DELETE_TASK', taskId: task.id });
          toast('タスクを削除しました');
          onClose();
        }}
      >
        このタスクを削除
      </button>
    </Sheet>
    {recordOpen && (
      <RecordSheet
        open
        onClose={() => setRecordOpen(false)}
        preset={{
          taskId: task.id,
          subjectId: task.subjectId,
          materialId: task.materialId,
          minutes,
          rangeLabel: `${task.title} ${task.rangeLabel}`,
          source: 'manual',
        }}
        onDone={onClose}
      />
    )}
    </>
  );
}

// ============================================================
// 手動タスク追加
// ============================================================

function ManualTaskSheet({ initialDate, onClose }: { initialDate: string; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const t = today();
  const [subjectId, setSubjectId] = useState(state.subjects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [range, setRange] = useState('');
  const [minutes, setMinutes] = useState(30);
  const [date, setDate] = useState(initialDate);
  const [memo, setMemo] = useState('');

  const save = () => {
    if (!title.trim() || !subjectId) {
      toast('タイトルと科目を入力してください');
      return;
    }
    dispatch({
      type: 'ADD_MANUAL_TASK',
      task: {
        id: genId('task'),
        subjectId,
        materialId: null,
        title: title.trim(),
        rangeLabel: range.trim(),
        rangeStart: null,
        rangeEnd: null,
        amount: 1,
        estimatedMinutes: minutes,
        priority: 60,
        dueDate: date,
        type: 'new',
        status: 'planned',
        scheduledDate: date,
        scheduledStart: null,
        scheduledEnd: null,
        generatedBy: 'manual',
        memo,
        reviewStage: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      },
    });
    toast('タスクを追加しました');
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title="タスクを追加">
      <div className="field">
        <label htmlFor="mt-title">タイトル</label>
        <input id="mt-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 模試の復習" />
      </div>
      <div className="field">
        <label htmlFor="mt-subject">科目</label>
        <select id="mt-subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          {state.subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="mt-range">範囲(任意)</label>
        <input id="mt-range" value={range} onChange={(e) => setRange(e.target.value)} placeholder="例: 大問1〜3" />
      </div>
      <div className="field-row">
        <div className="field">
          <label>予定時間</label>
          <Stepper value={minutes} onChange={setMinutes} step={5} min={10} max={180} suffix="分" />
        </div>
        <div className="field">
          <label htmlFor="mt-date">日付</label>
          <input id="mt-date" type="date" value={date} min={t} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="mt-memo">メモ</label>
        <textarea id="mt-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="やること、注意点など" />
      </div>
      <button className="btn btn-primary btn-block" onClick={save}>
        追加する
      </button>
    </Sheet>
  );
}
