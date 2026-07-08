import { useMemo, useState } from 'react';
import { useApp } from '../state/AppContext';
import { addDays, formatDateShort, formatMinutes, today, WEEKDAY_LABELS, weekdayOf, genId } from '../lib/date';
import { availableMinutesOn, fixedEventsOn } from '../lib/scheduler';
import type { StudyTask } from '../types';
import { Sheet } from '../components/ui/Sheet';
import { Stepper, TASK_TYPE_LABEL } from '../components/ui/bits';
import { useToast } from '../components/ui/Toast';

export function PlanScreen() {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const t = today();
  const [selected, setSelected] = useState<StudyTask | null>(null);
  const [addOpen, setAddOpen] = useState(false);

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

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <div className="screen-title">計画</div>
          <div className="screen-sub">これから1週間の学習ブロック</div>
        </div>
        <button className="icon-btn" aria-label="手動でタスクを追加" onClick={() => setAddOpen(true)}>
          ＋
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
          🔄 今週を再設計
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
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>⚠️ 未達成タスクが{overdueCount}件あります</span>
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

      <div className="week-grid mt-16">
        {days.map((d) => {
          const tasks = tasksByDay.get(d) ?? [];
          const events = fixedEventsOn(state, d);
          const capacity = availableMinutesOn(state, d);
          const planned = tasks.filter((x) => x.status !== 'skipped').reduce((s, x) => s + x.estimatedMinutes, 0);
          const isToday = d === t;
          return (
            <div key={d} className={`day-column ${isToday ? 'today-col' : ''}`}>
              <div className="row spread">
                <div style={{ fontWeight: 800, fontSize: 14.5 }}>
                  {isToday ? '今日' : `${formatDateShort(d)} (${WEEKDAY_LABELS[weekdayOf(d)]})`}
                </div>
                <span className="faint">
                  {formatMinutes(planned)} / {formatMinutes(capacity)}
                </span>
              </div>

              {events.map((ev) => (
                <div key={ev.id + d} className="mini-block" style={{ opacity: 0.65, cursor: 'default' }}>
                  <span aria-hidden="true">📌</span>
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
                    onClick={() => !done && setSelected(task)}
                    aria-label={`${task.title} ${task.rangeLabel} を編集`}
                  >
                    <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 4, background: subject?.color, flexShrink: 0 }} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {done && '✓ '}
                        {task.type === 'review' && '🔁 '}
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

      {selected && <TaskEditSheet task={selected} onClose={() => setSelected(null)} />}
      {addOpen && <ManualTaskSheet onClose={() => setAddOpen(false)} />}
    </div>
  );
}

// ============================================================
// タスク移動・時間変更シート(D&Dの代わりのタップUI)
// ============================================================

function TaskEditSheet({ task, onClose }: { task: StudyTask; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const t = today();
  const [minutes, setMinutes] = useState(task.estimatedMinutes);
  const subject = state.subjects.find((s) => s.id === task.subjectId);

  const moveTo = (date: string) => {
    dispatch({ type: 'MOVE_TASK', taskId: task.id, date });
    toast(`${formatDateShort(date)}に移動しました`);
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title="タスクを調整">
      <div className="card" style={{ padding: 13, marginBottom: 16 }}>
        <div className="task-meta-row">
          <span className="subject-chip" style={{ background: `${subject?.color}26`, color: subject?.color }}>
            {subject?.name}
          </span>
          <span className="task-type-chip">{TASK_TYPE_LABEL[task.type]}</span>
        </div>
        <div style={{ fontWeight: 700, marginTop: 4 }}>{task.title}</div>
        <div className="muted">{task.rangeLabel}</div>
      </div>

      <div className="field">
        <label>予定時間(分)</label>
        <div className="row">
          <div style={{ flex: 1 }}>
            <Stepper value={minutes} onChange={setMinutes} step={5} min={10} max={180} suffix="分" />
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              dispatch({
                type: 'ADD_MANUAL_TASK',
                task: { ...task, estimatedMinutes: minutes, generatedBy: 'manual' },
              });
              dispatch({ type: 'SET_TASK_STATUS', taskId: task.id, status: 'skipped' });
              toast('時間を変更しました');
              onClose();
            }}
          >
            適用
          </button>
        </div>
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
          className="btn btn-danger btn-sm"
          style={{ flex: 1 }}
          onClick={() => {
            dispatch({ type: 'SET_TASK_STATUS', taskId: task.id, status: 'skipped' });
            toast('タスクをスキップしました');
            onClose();
          }}
        >
          スキップ(やらない)
        </button>
        <button
          className="btn btn-secondary btn-sm"
          style={{ flex: 1 }}
          onClick={() => {
            dispatch({ type: 'POSTPONE_TASK', taskId: task.id });
            toast('明日以降に再配置しました');
            onClose();
          }}
        >
          延期して再計算
        </button>
      </div>
    </Sheet>
  );
}

// ============================================================
// 手動タスク追加
// ============================================================

function ManualTaskSheet({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const t = today();
  const [subjectId, setSubjectId] = useState(state.subjects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [range, setRange] = useState('');
  const [minutes, setMinutes] = useState(30);
  const [date, setDate] = useState(t);

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
      <button className="btn btn-primary btn-block" onClick={save}>
        追加する
      </button>
    </Sheet>
  );
}
