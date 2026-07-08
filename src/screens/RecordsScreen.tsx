import { useMemo, useState } from 'react';
import { useApp } from '../state/AppContext';
import { addDays, formatDateShort, formatMinutes, today, WEEKDAY_LABELS, weekdayOf } from '../lib/date';
import { computeAnalytics } from '../lib/analytics';
import { RecordSheet } from '../components/forms/RecordSheet';
import { EmptyState } from '../components/ui/bits';

export function RecordsScreen() {
  const { state } = useApp();
  const t = today();
  const [addOpen, setAddOpen] = useState(false);

  const analytics = useMemo(() => computeAnalytics(state, t), [state, t]);

  const last7 = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(t, -(6 - i))), [t]);
  const minutesByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of state.sessions) map.set(s.date, (map.get(s.date) ?? 0) + s.minutes);
    return map;
  }, [state.sessions]);
  const maxDay = Math.max(60, ...last7.map((d) => minutesByDay.get(d) ?? 0));

  // 直近7日の予定(比較用)
  const plannedByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of state.tasks) {
      if (task.status === 'skipped') continue;
      map.set(task.scheduledDate, (map.get(task.scheduledDate) ?? 0) + task.estimatedMinutes);
    }
    return map;
  }, [state.tasks]);

  const recentSessions = useMemo(
    () =>
      [...state.sessions]
        .filter((s) => s.date >= addDays(t, -6))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [state.sessions, t],
  );

  // 科目別時間(直近7日)
  const bySubject = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of state.sessions) {
      if (s.date < addDays(t, -6)) continue;
      map.set(s.subjectId, (map.get(s.subjectId) ?? 0) + s.minutes);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [state.sessions, t]);
  const maxSubject = Math.max(1, ...bySubject.map(([, m]) => m));

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <div className="screen-title">記録</div>
          <div className="screen-sub">
            今週 {formatMinutes(analytics.weekMinutes)} ・ 今月 {formatMinutes(analytics.monthMinutes)} ・ 🔥 {analytics.streakDays}日連続
          </div>
        </div>
        <button className="icon-btn" aria-label="記録を手動で追加" onClick={() => setAddOpen(true)}>
          ＋
        </button>
      </div>

      {/* 予定 vs 実績 (7日) */}
      <div className="card">
        <div className="section-label" style={{ margin: '0 0 12px' }}>
          直近7日間 予定 vs 実績
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 130 }}>
          {last7.map((d) => {
            const actual = minutesByDay.get(d) ?? 0;
            const planned = plannedByDay.get(d) ?? 0;
            return (
              <div key={d} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, height: '100%' }}>
                <div style={{ flex: 1, width: '100%', display: 'flex', gap: 3, alignItems: 'flex-end', justifyContent: 'center' }}>
                  <div
                    title={`予定 ${formatMinutes(planned)}`}
                    style={{
                      width: '34%',
                      height: `${Math.min(100, (planned / maxDay) * 100)}%`,
                      background: 'var(--bg-elev3)',
                      borderRadius: 5,
                      minHeight: planned > 0 ? 4 : 0,
                    }}
                  />
                  <div
                    title={`実績 ${formatMinutes(actual)}`}
                    style={{
                      width: '34%',
                      height: `${Math.min(100, (actual / maxDay) * 100)}%`,
                      background: 'var(--accent-grad)',
                      borderRadius: 5,
                      minHeight: actual > 0 ? 4 : 0,
                    }}
                  />
                </div>
                <span className="faint" style={{ fontSize: 10.5, fontWeight: 700, color: d === t ? 'var(--accent)' : undefined }}>
                  {WEEKDAY_LABELS[weekdayOf(d)]}
                </span>
              </div>
            );
          })}
        </div>
        <div className="row mt-8" style={{ gap: 14, justifyContent: 'center' }}>
          <span className="faint">
            <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 3, background: 'var(--bg-elev3)', marginRight: 5 }} />
            予定
          </span>
          <span className="faint">
            <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 3, background: 'var(--accent)', marginRight: 5 }} />
            実績
          </span>
        </div>
      </div>

      {/* 科目別 */}
      {bySubject.length > 0 && (
        <div className="card mt-12">
          <div className="section-label" style={{ margin: '0 0 12px' }}>
            科目別の学習時間(7日)
          </div>
          {bySubject.map(([sid, min]) => {
            const subject = state.subjects.find((s) => s.id === sid);
            return (
              <div key={sid} className="row" style={{ marginBottom: 9 }}>
                <span style={{ width: 46, fontSize: 12.5, fontWeight: 700, color: subject?.color, flexShrink: 0 }}>{subject?.name}</span>
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
                <span className="faint" style={{ width: 62, textAlign: 'right', flexShrink: 0 }}>
                  {formatMinutes(min)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* セッション一覧 */}
      <div className="section-label">学習ログ(7日)</div>
      {recentSessions.length === 0 ? (
        <EmptyState icon="📝" title="まだ記録がありません">
          タイマーで勉強するか、「＋」から手動で記録できます。
        </EmptyState>
      ) : (
        recentSessions.map((s) => {
          const subject = state.subjects.find((x) => x.id === s.subjectId);
          const material = state.materials.find((x) => x.id === s.materialId);
          return (
            <div className="task-card" key={s.id}>
              <div className="subject-bar" style={{ background: subject?.color ?? 'var(--accent)' }} />
              <div className="task-main">
                <div className="task-meta-row">
                  <span className="subject-chip" style={{ background: `${subject?.color}26`, color: subject?.color }}>
                    {subject?.name}
                  </span>
                  <span className="task-type-chip">{s.source === 'timer' ? '⏱ タイマー' : '✍️ 手入力'}</span>
                  <span className="task-time">{s.date === t ? '今日' : formatDateShort(s.date)}</span>
                </div>
                <div className="task-title">{material?.name ?? s.rangeLabel ?? '学習'}</div>
                <div className="task-range">
                  {formatMinutes(s.minutes)}
                  {s.amountDone > 0 && material && ` ・ ${s.amountDone}${material.unit}`}
                  {s.accuracy !== null && ` ・ 正答率${s.accuracy}%`}
                  {s.focus !== null && ` ・ 🔥${s.focus}`}
                </div>
                {s.memo && <div className="faint mt-8">{s.memo}</div>}
              </div>
            </div>
          );
        })
      )}

      {addOpen && <RecordSheet open onClose={() => setAddOpen(false)} />}
    </div>
  );
}
