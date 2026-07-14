import { useMemo, useState } from 'react';
import { PenLine, Plus, Share2, Timer } from 'lucide-react';
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
  const delta = deltaLabel(totalActual, prevActual);

  const sessions = useMemo(
    () =>
      [...state.sessions]
        .filter((s) => s.date >= from && s.date <= to)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [state.sessions, from, to],
  );

  const bySubject = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sessions) map.set(s.subjectId, (map.get(s.subjectId) ?? 0) + s.minutes);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [sessions]);
  const maxSubject = Math.max(1, ...bySubject.map(([, m]) => m));

  const switchPeriod = (next: Period) => {
    setPeriod(next);
    setOffset(0);
  };

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <div className="screen-title">記録</div>
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

      <div className="segmented" role="tablist" aria-label="集計期間">
        <button className={period === 'week' ? 'active' : ''} onClick={() => switchPeriod('week')}>週</button>
        <button className={period === 'month' ? 'active' : ''} onClick={() => switchPeriod('month')}>月</button>
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

      {/* サマリー */}
      <div className="day-stats mt-12">
        <div><b>{formatMinutesTile(totalActual)}</b><span>合計</span></div>
        <div><b>{formatMinutesTile(Math.round(dailyAvg))}</b><span>日平均</span></div>
        <div><b>{studyDays}/{days.length}日</b><span>学習日</span></div>
        <div>
          <b style={{ color: delta.positive ? 'var(--ok)' : 'var(--danger)' }}>{delta.text}</b>
          <span>{period === 'week' ? (partial ? '前週同時点' : '前週比') : partial ? '前月同時点' : '前月比'}</span>
        </div>
      </div>

      {/* 週間目標(Studyplus式) */}
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

      {/* 科目別 */}
      {bySubject.length > 0 && (
        <div className="card mt-12">
          <div className="section-label" style={{ margin: '0 0 12px' }}>科目別の学習時間</div>
          {bySubject.map(([sid, min]) => {
            const subject = state.subjects.find((s) => s.id === sid);
            return (
              <div key={sid} className="row" style={{ marginBottom: 9 }}>
                <span
                  style={{
                    minWidth: 46,
                    maxWidth: 88,
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: subject?.color,
                    flexShrink: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {subject?.name}
                </span>
                <div style={{ flex: 1, height: 9, background: 'var(--bg-elev3)', borderRadius: 100 }}>
                  <div
                    style={{
                      width: `${(min / maxSubject) * 100}%`,
                      height: '100%',
                      borderRadius: 100,
                      background: subject?.color ?? 'var(--accent)',
                      transition: 'width 0.5s ease',
                    }}
                  />
                </div>
                <span className="faint" style={{ width: 78, textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {formatMinutesTile(min)}
                  <span style={{ marginLeft: 4 }}>{totalActual > 0 ? `${Math.round((min / totalActual) * 100)}%` : ''}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* セッション一覧 */}
      <div className="section-label">学習ログ({sessions.length}件)</div>
      {sessions.length === 0 ? (
        <EmptyState icon="📝" title="この期間の記録はありません">
          タイマーで勉強するか、「＋」から手動で記録できます。
        </EmptyState>
      ) : (
        <SessionLog sessions={sessions} state={state} t={t} onEdit={setEditSession} />
      )}

      {/* 実績バッジ */}
      <div className="section-label">
        <span>実績バッジ</span>
        <span className="faint">{unlockedCount(achievements)}/{achievements.length} 獲得</span>
      </div>
      <div className="badge-grid">
        {achievements.map((a) => (
          <div key={a.id} className={`badge-cell ${a.unlocked ? 'unlocked' : ''}`} title={a.desc}>
            <span className="badge-icon" aria-hidden="true">{a.icon}</span>
            <span className="badge-title">{a.title}</span>
            <span className="badge-desc">{a.unlocked ? '獲得!' : a.progressLabel}</span>
            {!a.unlocked && (
              <div className="badge-progress" aria-hidden="true">
                <div style={{ width: `${Math.round(a.progress * 100)}%` }} />
              </div>
            )}
          </div>
        ))}
      </div>

      {addOpen && <RecordSheet open onClose={() => setAddOpen(false)} />}
      {editSession && <RecordSheet open session={editSession} onClose={() => setEditSession(null)} />}
    </div>
  );
}

// ============================================================
// 週の予定 vs 実績バーチャート
// ============================================================

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
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  const subjectMinutes = new Map<string, Map<string, number>>();
  for (const session of sessions) {
    const map = subjectMinutes.get(session.date) ?? new Map<string, number>();
    map.set(session.subjectId, (map.get(session.subjectId) ?? 0) + session.minutes);
    subjectMinutes.set(session.date, map);
  }
  const visibleSubjects = subjects
    .map((subject) => ({
      subject,
      minutes: days.reduce((sum, day) => sum + (subjectMinutes.get(day)?.get(subject.id) ?? 0), 0),
    }))
    .filter((item) => item.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

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
            .map(([subjectId, minutes]) => ({ subject: subjectById.get(subjectId), minutes }));
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
                      key={subject?.id ?? 'unknown'}
                      className="studyplus-stack"
                      title={`${subject?.name ?? '不明'} ${formatMinutes(minutes)}`}
                      style={{
                        height: `${Math.max(8, (minutes / Math.max(1, actual)) * 100)}%`,
                        background: subject?.color ?? 'var(--accent)',
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

// ============================================================
// 月のヒートカレンダー
// ============================================================

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

// ============================================================
// 学習ログ(日付見出し付き)
// ============================================================

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
    const subject = state.subjects.find((x) => x.id === s.subjectId);
    const material = state.materials.find((x) => x.id === s.materialId);
    out.push(
      <button type="button" className="task-card session-log-button" key={s.id} onClick={() => onEdit(s)} aria-label={`${material?.name ?? s.rangeLabel ?? '学習'}の記録を編集`}>
        <div className="subject-bar" style={{ background: subject?.color ?? 'var(--accent)' }} />
        <div className="task-main">
          <div className="task-meta-row">
            <span className="subject-chip" style={{ background: `${subject?.color}26`, color: subject?.color }}>
              {subject?.name}
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
