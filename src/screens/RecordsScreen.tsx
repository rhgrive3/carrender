import { useMemo, useState } from 'react';
import { PenLine, Plus, Search, Share2, Timer } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { useToast } from '../components/ui/Toast';
import { computeAchievements, unlockedCount } from '../lib/achievements';
import { shareStudyCard } from '../lib/sharecard';
import { isPlacedPlanTask } from '../lib/taskFilters';
import { stablePlanTasks } from '../lib/progressChart';
import { ProgressBar } from '../components/ui/bits';
import {
  addDays,
  addMonths,
  daysInMonthOf,
  formatDateShort,
  formatMinutes,
  formatMinutesCompact,
  formatMinutesTile,
  monthKeyOf,
  monthLabel,
  startOfWeek,
  today,
  WEEKDAY_LABELS,
  weekdayOf,
} from '../lib/date';
import { computeAnalytics } from '../lib/analytics';
import { RecordSheet } from '../components/forms/RecordSheet';
import { EmptyState } from '../components/ui/bits';
import { MonthCalendar } from '../components/ui/MonthCalendar';
import { recordLogSubjectOptions, resolveRecordSubject, summarizeRecordSubjects } from '../lib/recordSubjects';
import type { AppState, StudySession, Subject } from '../types';

type Period = 'week' | 'month';

/** 期間内の日付リスト(週: 日〜土 / 月: 1日〜末日) */
function periodDays(period: Period, offset: number, t: string): string[] {
  if (period === 'week') {
    const start = addDays(startOfWeek(t), offset * 7);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }
  const month = addMonths(monthKeyOf(t), offset);
  return Array.from({ length: daysInMonthOf(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

function periodTitle(period: Period, offset: number, t: string): string {
  if (period === 'month') return monthLabel(addMonths(monthKeyOf(t), offset));
  if (offset === 0) return '今週';
  if (offset === -1) return '先週';
  const start = addDays(startOfWeek(t), offset * 7);
  return `${formatDateShort(start)}〜${formatDateShort(addDays(start, 6))}`;
}

function sumRange(minutesByDay: Map<string, number>, days: string[]): number {
  return days.reduce((s, d) => s + (minutesByDay.get(d) ?? 0), 0);
}

function deltaLabel(current: number, previous: number): { text: string; positive: boolean } {
  const diff = current - previous;
  if (Math.abs(diff) < 1) return { text: '±0', positive: true };
  return { text: `${diff > 0 ? '+' : '-'}${formatMinutesTile(Math.abs(diff))}`, positive: diff > 0 };
}

export function RecordsScreen() {
  const { state } = useApp();
  const t = today();
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editSession, setEditSession] = useState<StudySession | null>(null);
  const [period, setPeriod] = useState<Period>('week');
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<'overview' | 'log'>('log');
  const [logQuery, setLogQuery] = useState('');
  const [logSubject, setLogSubject] = useState('all');
  const [logDate, setLogDate] = useState('');

  const analytics = useMemo(() => computeAnalytics(state, t), [state, t]);
  const achievements = useMemo(() => computeAchievements(state, t), [state, t]);

  const doShare = async () => {
    const result = await shareStudyCard(state, t);
    if (result === 'downloaded') toast('シェア画像を保存しました');
    else if (result === 'failed') toast('画像の生成に失敗しました');
  };

  const minutesByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of state.sessions) map.set(s.date, (map.get(s.date) ?? 0) + s.minutes);
    return map;
  }, [state.sessions]);

  const plannedByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of stablePlanTasks(state.tasks, state.sessions)) {
      if (!isPlacedPlanTask(task)) continue;
      map.set(task.scheduledDate, (map.get(task.scheduledDate) ?? 0) + task.estimatedMinutes);
    }
    for (const entry of state.planHistory ?? []) {
      map.set(entry.scheduledDate, (map.get(entry.scheduledDate) ?? 0) + entry.estimatedMinutes);
    }
    return map;
  }, [state.planHistory, state.sessions, state.tasks]);

  const days = useMemo(() => periodDays(period, offset, t), [period, offset, t]);
  const prevDays = useMemo(() => periodDays(period, offset - 1, t), [period, offset, t]);
  const from = days[0];
  const to = days[days.length - 1];

  const totalActual = sumRange(minutesByDay, days);
  const totalPlanned = days.filter((d) => d <= t).reduce((s, d) => s + (plannedByDay.get(d) ?? 0), 0);
  const studyDays = days.filter((d) => (minutesByDay.get(d) ?? 0) > 0).length;
  const elapsedDays = days.filter((d) => d <= t).length;
  // 進行中の期間は前期間の「同じ日数分まで」と比べる(週の途中で丸ごと前週と比べると常にマイナスに見えるため)
  const partial = elapsedDays < days.length;
  const prevActual = sumRange(minutesByDay, partial ? prevDays.slice(0, elapsedDays) : prevDays);
  const dailyAvg = elapsedDays > 0 ? totalActual / elapsedDays : 0;
  // 進行中の週・月では未来日を未学習日として数えず、日平均と同じ経過日数基準で表示する。
  const studyDayDenominator = partial ? elapsedDays : days.length;
  const delta = deltaLabel(totalActual, prevActual);

  const sessions = useMemo(
    () =>
      [...state.sessions]
        .filter((s) => s.date >= from && s.date <= to)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [state.sessions, from, to],
  );

  const bySubject = useMemo(
    () => summarizeRecordSubjects(sessions, state.subjects),
    [sessions, state.subjects],
  );
  const logSubjectOptions = useMemo(
    () => recordLogSubjectOptions(state.sessions, state.subjects),
    [state.sessions, state.subjects],
  );
  const maxSubject = Math.max(1, ...bySubject.map(({ minutes }) => minutes));
  const filteredLogSessions = useMemo(() => {
    const query = logQuery.trim().toLocaleLowerCase('ja');
    return [...state.sessions]
      .filter((session) => logSubject === 'all' || session.subjectId === logSubject)
      .filter((session) => !logDate || session.date === logDate)
      .filter((session) => {
        if (!query) return true;
        const subject = resolveRecordSubject(state.subjects, session.subjectId);
        const material = state.materials.find((item) => item.id === session.materialId);
        return `${subject.name} ${material?.name ?? ''} ${session.rangeLabel} ${session.memo}`.toLocaleLowerCase('ja').includes(query);
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }, [logDate, logQuery, logSubject, state.materials, state.sessions, state.subjects]);

  const switchPeriod = (next: Period) => {
    setPeriod(next);
    setOffset(0);
  };

  return (
    <div className="screen records-v2">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">記録</h1>
          <div className="screen-sub">
            今週 {formatMinutes(analytics.weekMinutes)} ・ 今月 {formatMinutes(analytics.monthMinutes)} ・ 🔥 {analytics.streakDays}日連続
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="icon-btn" aria-label="今日の記録をシェア画像にする" onClick={doShare}>
            <Share2 size={20} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <button className="icon-btn" aria-label="記録を手動で追加" onClick={() => setAddOpen(true)}>
            <Plus size={22} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="segmented record-view-switch" role="tablist" aria-label="記録画面の切替">
        <button role="tab" aria-selected={view === 'overview'} className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}>集計</button>
        <button role="tab" aria-selected={view === 'log'} className={view === 'log' ? 'active' : ''} onClick={() => setView('log')}>学習ログ</button>
      </div>

      {view === 'overview' && <div className="record-overview">
      <div className="segmented" role="tablist" aria-label="集計期間">
        <button role="tab" aria-selected={period === 'week'} className={period === 'week' ? 'active' : ''} onClick={() => switchPeriod('week')}>週</button>
        <button role="tab" aria-selected={period === 'month'} className={period === 'month' ? 'active' : ''} onClick={() => switchPeriod('month')}>月</button>
      </div>

      <div className="period-nav mt-12">
        <button aria-label={period === 'week' ? '前の週' : '前の月'} onClick={() => setOffset(offset - 1)}>‹</button>
        <b>{periodTitle(period, offset, t)}</b>
        <div className="row" style={{ gap: 6 }}>
          {offset !== 0 && (
            <button style={{ width: 'auto', padding: '0 10px', fontSize: 12 }} onClick={() => setOffset(0)}>
              {period === 'week' ? '今週' : '今月'}
            </button>
          )}
          <button aria-label={period === 'week' ? '次の週' : '次の月'} disabled={offset >= 0} onClick={() => setOffset(offset + 1)}>›</button>
        </div>
      </div>

      <div className="day-stats mt-12">
        <div><b>{formatMinutesTile(totalActual)}</b><span>合計</span></div>
        <div><b>{formatMinutesTile(Math.round(dailyAvg))}</b><span>日平均</span></div>
        <div><b>{studyDays}/{studyDayDenominator}日</b><span>学習日</span></div>
        <div>
          <b style={{ color: delta.positive ? 'var(--ok)' : 'var(--danger)' }}>{delta.text}</b>
          <span>{period === 'week' ? (partial ? '前週同時点' : '前週比') : partial ? '前月同時点' : '前月比'}</span>
        </div>
      </div>

      {period === 'week' && offset === 0 && state.settings.weeklyTargetMinutes > 0 && (
        <div className="card mt-12" style={{ padding: 13 }}>
          <div className="row spread" style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800 }}>🎯 週間目標</span>
            <span className="faint" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatMinutesTile(totalActual)} / {formatMinutesTile(state.settings.weeklyTargetMinutes)}
              ({Math.round((totalActual / state.settings.weeklyTargetMinutes) * 100)}%)
            </span>
          </div>
          <ProgressBar value={totalActual / state.settings.weeklyTargetMinutes} color={totalActual >= state.settings.weeklyTargetMinutes ? 'var(--ok)' : undefined} />
          {totalActual >= state.settings.weeklyTargetMinutes && (
            <div className="faint mt-8" style={{ color: 'var(--ok)', fontWeight: 700 }}>今週の目標を達成しました 🎉</div>
          )}
        </div>
      )}

      {period === 'week' ? (
        <WeekChart
          days={days}
          sessions={sessions}
          subjects={state.subjects}
          minutesByDay={minutesByDay}
          plannedByDay={plannedByDay}
          totalPlanned={totalPlanned}
          totalActual={totalActual}
        />
      ) : (
        <MonthHeatCalendar month={addMonths(monthKeyOf(t), offset)} minutesByDay={minutesByDay} />
      )}

      {bySubject.length > 0 && (
        <div className="card mt-12">
          <div className="section-label" style={{ margin: '0 0 12px' }}>科目別の学習時間</div>
          {bySubject.map(({ subject, minutes }) => (
            <div key={subject.id} className="row" style={{ marginBottom: 9 }}>
              <span
                style={{
                  minWidth: 46,
                  maxWidth: 88,
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: subject.color,
                  flexShrink: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {subject.name}
              </span>
              <div style={{ flex: 1, height: 9, background: 'var(--bg-elev3)', borderRadius: 100 }}>
                <div
                  style={{
                    width: `${(minutes / maxSubject) * 100}%`,
                    height: '100%',
                    borderRadius: 100,
                    background: subject.color,
                    transition: 'width 0.5s ease',
                  }}
                />
              </div>
              <span className="faint" style={{ width: 78, textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                {formatMinutesTile(minutes)}
                <span style={{ marginLeft: 4 }}>{totalActual > 0 ? `${Math.round((minutes / totalActual) * 100)}%` : ''}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      </div>}

      {view === 'log' && (
        <section className="record-log-view" aria-labelledby="record-log-title">
          <div className="record-log-heading">
            <div><span className="section-kicker">履歴</span><h2 id="record-log-title">学習ログ</h2></div>
            <span className="faint">{filteredLogSessions.length}件</span>
          </div>
          <div className="record-log-filters">
            <label className="record-search">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">学習ログを検索</span>
              <input value={logQuery} onChange={(event) => setLogQuery(event.target.value)} placeholder="教材・科目・メモを検索" />
            </label>
            <label><span className="sr-only">科目で絞り込む</span><select value={logSubject} onChange={(event) => setLogSubject(event.target.value)}><option value="all">すべての科目</option>{logSubjectOptions.map((subject) => <option value={subject.id} key={subject.id}>{subject.name}</option>)}</select></label>
            <label><span className="sr-only">日付で絞り込む</span><input type="date" value={logDate} max={t} onChange={(event) => setLogDate(event.target.value)} /></label>
          </div>
          {filteredLogSessions.length === 0 ? (
            <EmptyState icon="📝" title="条件に合う記録はありません">検索条件を変えるか、「＋」から記録を追加できます。</EmptyState>
          ) : (
            <div className="record-log-list"><SessionLog sessions={filteredLogSessions} state={state} t={t} onEdit={setEditSession} /></div>
          )}
        </section>
      )}

      {view === 'overview' && (
        <details className="record-achievements">
          <summary><span>実績バッジ</span><span>{unlockedCount(achievements)}/{achievements.length} 獲得</span></summary>
          <div className="badge-grid">
            {achievements.map((achievement) => (
              <div key={achievement.id} className={`badge-cell ${achievement.unlocked ? 'unlocked' : ''}`} title={achievement.desc}>
                <span className="badge-icon" aria-hidden="true">{achievement.icon}</span>
                <span className="badge-title">{achievement.title}</span>
                <span className="badge-desc">{achievement.unlocked ? '獲得!' : achievement.progressLabel}</span>
                {!achievement.unlocked && <div className="badge-progress" aria-hidden="true"><div style={{ width: `${Math.round(achievement.progress * 100)}%` }} /></div>}
              </div>
            ))}
          </div>
        </details>
      )}

      {addOpen && <RecordSheet open onClose={() => setAddOpen(false)} />}
      {editSession && <RecordSheet open session={editSession} onClose={() => setEditSession(null)} />}
    </div>
  );
}

function WeekChart({
  days,
  sessions,
  subjects,
  minutesByDay,
  plannedByDay,
  totalPlanned,
  totalActual,
}: {
  days: string[];
  sessions: StudySession[];
  subjects: Subject[];
  minutesByDay: Map<string, number>;
  plannedByDay: Map<string, number>;
  totalPlanned: number;
  totalActual: number;
}) {
  const t = today();
  const maxDay = Math.max(60, ...days.map((d) => Math.max(minutesByDay.get(d) ?? 0, plannedByDay.get(d) ?? 0)));
  const achievement = totalPlanned > 0 ? Math.min(999, Math.round((totalActual / totalPlanned) * 100)) : null;
  const subjectMinutes = new Map<string, Map<string, number>>();
  for (const session of sessions) {
    const map = subjectMinutes.get(session.date) ?? new Map<string, number>();
    map.set(session.subjectId, (map.get(session.subjectId) ?? 0) + session.minutes);
    subjectMinutes.set(session.date, map);
  }
  const visibleSubjects = summarizeRecordSubjects(sessions, subjects);

  return (
    <div className="card mt-12 studyplus-chart-card">
      <div className="row spread studyplus-chart-head">
        <div className="section-label" style={{ margin: 0 }}>予定 vs 実績</div>
        {achievement !== null && <span className="faint" style={{ fontWeight: 700 }}>達成率 {achievement}%</span>}
      </div>
      <div className="studyplus-chart">
        {days.map((d) => {
          const actual = minutesByDay.get(d) ?? 0;
          const planned = plannedByDay.get(d) ?? 0;
          const future = d > t;
          const stacks = [...(subjectMinutes.get(d)?.entries() ?? [])]
            .sort((a, b) => b[1] - a[1])
            .map(([subjectId, minutes]) => ({
              subject: resolveRecordSubject(subjects, subjectId),
              minutes,
            }));
          return (
            <div key={d} className={`studyplus-day ${future ? 'future' : ''}`}>
              <div className="studyplus-total">{actual > 0 ? formatMinutesCompact(actual) : ''}</div>
              <div className="studyplus-bar-area">
                <div
                  className="studyplus-plan-rail"
                  title={`予定 ${formatMinutes(planned)}`}
                  style={{ height: `${Math.min(100, (planned / maxDay) * 100)}%` }}
                />
                <div
                  className="studyplus-actual-bar"
                  title={`実績 ${formatMinutes(actual)}`}
                  style={{ height: `${Math.min(100, (actual / maxDay) * 100)}%` }}
                >
                  {stacks.map(({ subject, minutes }) => (
                    <div
                      key={subject.id}
                      className="studyplus-stack"
                      title={`${subject.name} ${formatMinutes(minutes)}`}
                      style={{
                        height: `${Math.max(8, (minutes / Math.max(1, actual)) * 100)}%`,
                        background: subject.color,
                      }}
                    />
                  ))}
                </div>
              </div>
              <span className={`studyplus-weekday ${d === t ? 'today' : ''}`}>
                {WEEKDAY_LABELS[weekdayOf(d)]}
              </span>
            </div>
          );
        })}
      </div>
      <div className="studyplus-legend">
        <span className="studyplus-legend-item muted-legend">
          <span className="studyplus-legend-rail" />
          予定
        </span>
        {visibleSubjects.map(({ subject }) => (
          <span key={subject.id} className="studyplus-legend-item">
            <span className="studyplus-legend-dot" style={{ background: subject.color }} />
            {subject.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function MonthHeatCalendar({ month, minutesByDay }: { month: string; minutesByDay: Map<string, number> }) {
  const monthDays = Array.from({ length: daysInMonthOf(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const max = Math.max(60, ...monthDays.map((d) => minutesByDay.get(d) ?? 0));

  return (
    <div className="card mt-12" style={{ padding: 13 }}>
      <MonthCalendar
        month={month}
        renderDay={(d) => {
          const min = minutesByDay.get(d) ?? 0;
          return <span className="cal-cell-min">{formatMinutesCompact(min)}</span>;
        }}
        cellStyle={(d) => {
          const min = minutesByDay.get(d) ?? 0;
          if (min <= 0) return undefined;
          const ratio = Math.min(1, min / max);
          return { background: `color-mix(in srgb, var(--bg-elev1), var(--accent) ${Math.round(12 + ratio * 55)}%)` };
        }}
      />
      <div className="faint mt-8" style={{ fontSize: 11.5 }}>色が濃い日ほど学習時間が長い日です</div>
    </div>
  );
}

function SessionLog({ sessions, state, t, onEdit }: { sessions: StudySession[]; state: AppState; t: string; onEdit: (session: StudySession) => void }) {
  let lastDate = '';
  const out: JSX.Element[] = [];
  for (const s of sessions) {
    if (s.date !== lastDate) {
      lastDate = s.date;
      const dayTotal = sessions.filter((x) => x.date === s.date).reduce((sum, x) => sum + x.minutes, 0);
      out.push(
        <div key={`h-${s.date}`} className="row spread" style={{ margin: '10px 2px 6px' }}>
          <span style={{ fontSize: 12.5, fontWeight: 800 }}>
            {s.date === t ? '今日' : `${formatDateShort(s.date)} (${WEEKDAY_LABELS[weekdayOf(s.date)]})`}
          </span>
          <span className="faint">{formatMinutes(dayTotal)}</span>
        </div>,
      );
    }
    const subject = resolveRecordSubject(state.subjects, s.subjectId);
    const material = state.materials.find((x) => x.id === s.materialId);
    out.push(
      <button type="button" className="task-card session-log-button" key={s.id} onClick={() => onEdit(s)} aria-label={`${material?.name ?? s.rangeLabel ?? '学習'}の記録を編集`}>
        <div className="subject-bar" style={{ background: subject.color }} />
        <div className="task-main">
          <div className="task-meta-row">
            <span className="subject-chip" style={{ background: `color-mix(in srgb, ${subject.color}, transparent 85%)`, color: subject.color }}>
              {subject.name}
            </span>
            <span className="task-type-chip iflex" style={{ gap: 3 }}>
              {s.source === 'timer' ? (
                <><Timer size={11} strokeWidth={2.4} aria-hidden="true" /> タイマー</>
              ) : (
                <><PenLine size={11} strokeWidth={2.4} aria-hidden="true" /> 手入力</>
              )}
            </span>
          </div>
          <div className="task-title">{material?.name ?? s.rangeLabel ?? '学習'}</div>
          <div className="task-range">
            {formatMinutes(s.minutes)}
            {s.amountDone > 0 && material && ` ・ ${s.amountDone}${material.unit}`}
            {s.focus !== null && ` ・ 🔥${s.focus}`}
          </div>
          {s.memo && <div className="faint mt-8">{s.memo}</div>}
        </div>
      </button>,
    );
  }
  return <>{out}</>;
}
