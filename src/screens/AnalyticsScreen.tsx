import { useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { computeAnalytics } from '../lib/analytics';
import { diffDays, formatDateShort, formatHoursShort, formatMinutes, formatMinutesTile, today } from '../lib/date';
import { ProgressRing } from '../components/ui/ProgressRing';
import { ProgressBar, EmptyState } from '../components/ui/bits';

export function AnalyticsScreen() {
  const { state } = useApp();
  const t = today();
  const a = useMemo(() => computeAnalytics(state, t), [state, t]);

  const daysLeft = state.goal ? diffDays(t, state.goal.examDate) : null;
  const capacityRate =
    a.capacity.totalAvailableMinutes > 0
      ? Math.min(1, a.capacity.totalRemainingMinutes / a.capacity.totalAvailableMinutes)
      : 0;

  // 苦手科目ランキング: 達成率×正答率が低い順
  const weakRanking = useMemo(() => {
    return a.subjectStats
      .filter((s) => s.plannedMinutes > 0 || s.actualMinutes > 0)
      .map((s) => {
        const acc = s.avgAccuracy ?? 75;
        const score = s.completionRate * 0.5 + (acc / 100) * 0.5;
        return { ...s, weakScore: score };
      })
      .sort((x, y) => x.weakScore - y.weakScore)
      .slice(0, 3);
  }, [a.subjectStats]);

  // 予定より時間がかかっている教材(実績ペースが必要ペースの70%未満)
  const slowMaterials = a.materialForecasts.filter(
    (f) => f.remainingAmount > 0 && f.currentPacePerDay > 0 && f.currentPacePerDay < f.requiredPacePerDay * 0.7,
  );

  const maxHeat = Math.max(30, ...a.heatmap.map((h) => h.minutes));

  const hasData = state.sessions.length > 0 || state.tasks.length > 0;

  if (!hasData) {
    return (
      <div className="screen">
        <div className="screen-header">
          <div>
            <div className="screen-title">分析</div>
          </div>
        </div>
        <EmptyState icon="📊" title="分析するデータがまだありません">
          勉強を記録すると、進捗予測・科目バランス・改善点がここに表示されます。
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <div className="screen-title">分析</div>
          <div className="screen-sub">実績データから自動計算</div>
        </div>
      </div>

      {/* 試験日までの見込み */}
      <div className="hero-card">
        <div className="hero-topline">
          <span style={{ fontWeight: 800, fontSize: 15 }}>試験日までに終わる?</span>
          {a.capacity.ok ? (
            <span className="status-badge status-ok">✓ 間に合う見込み</span>
          ) : (
            <span className="status-badge status-danger">⚠ 不足あり</span>
          )}
        </div>
        <div className="hero-stats">
          <ProgressRing
            value={capacityRate}
            label={`${Math.round(capacityRate * 100)}%`}
            sublabel="時間の使用率"
            color={a.capacity.ok ? undefined : 'var(--danger)'}
          />
          <div className="hero-numbers">
            <div className="stat-block">
              <div className="stat-value">{formatHoursShort(a.capacity.totalRemainingMinutes)}</div>
              <div className="stat-label">残りの学習量</div>
            </div>
            <div className="stat-block">
              <div className="stat-value">{formatHoursShort(a.capacity.totalAvailableMinutes)}</div>
              <div className="stat-label">確保できる時間</div>
            </div>
            <div className="stat-block">
              <div className="stat-value" style={{ color: a.capacity.ok ? 'var(--ok)' : 'var(--danger)' }}>
                {a.capacity.ok ? `+${formatHoursShort(-a.capacity.deficitMinutes)}` : `-${formatHoursShort(a.capacity.deficitMinutes)}`}
              </div>
              <div className="stat-label">{a.capacity.ok ? '余裕' : '不足時間'}</div>
            </div>
            {daysLeft !== null && (
              <div className="stat-block">
                <div className="stat-value">{daysLeft}日</div>
                <div className="stat-label">試験まで</div>
              </div>
            )}
          </div>
        </div>
        <p className="faint" style={{ marginTop: 12, fontSize: 11.5, lineHeight: 1.5 }}>
          使用率 = 残りの学習量 ÷ 試験日までに確保できる時間。100%を超えると計画が入り切りません。
        </p>
      </div>

      {/* 自動コメント */}
      <div className="section-label">💡 今週の改善点</div>
      <div className="card">
        {a.comments.map((c, i) => (
          <p key={i} style={{ fontSize: 14, lineHeight: 1.65, marginTop: i === 0 ? 0 : 10 }}>
            ・{c}
          </p>
        ))}
      </div>

      {/* KPI行 */}
      <div className="row mt-12" style={{ gap: 10 }}>
        <div className="card" style={{ flex: 1, textAlign: 'center', padding: 13 }}>
          <div style={{ fontSize: 21, fontWeight: 800 }}>{Math.round(a.planAchievementRate7d * 100)}%</div>
          <div className="faint">予定達成率(7日)</div>
        </div>
        <div className="card" style={{ flex: 1, textAlign: 'center', padding: 13, margin: 0 }}>
          <div style={{ fontSize: 21, fontWeight: 800 }}>🔥 {a.streakDays}日</div>
          <div className="faint">連続(最高{a.bestStreakDays}日)</div>
        </div>
        <div className="card" style={{ flex: 1, textAlign: 'center', padding: 13, margin: 0 }}>
          <div style={{ fontSize: 21, fontWeight: 800, color: a.overdueReviewCount > 0 ? 'var(--warn)' : undefined }}>
            {a.overdueReviewCount}件
          </div>
          <div className="faint">復習の滞留</div>
        </div>
      </div>

      {/* 科目バランス */}
      <div className="section-label">科目バランス(14日)</div>
      <div className="card">
        {a.subjectStats
          .filter((s) => s.plannedMinutes > 0 || s.actualMinutes > 0)
          .map((s) => {
            const subject = state.subjects.find((x) => x.id === s.subjectId);
            const max = Math.max(1, ...a.subjectStats.map((x) => Math.max(x.plannedMinutes, x.actualMinutes)));
            return (
              <div key={s.subjectId} style={{ marginBottom: 13 }}>
                <div className="row spread" style={{ marginBottom: 5 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: subject?.color }}>{subject?.name}</span>
                  <span className="faint">
                    達成率{Math.round(s.completionRate * 100)}%
                    {s.avgAccuracy !== null && ` ・ 正答率${Math.round(s.avgAccuracy)}%`}
                  </span>
                </div>
                <div style={{ display: 'grid', gap: 4 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <div style={{ flex: 1, height: 7, background: 'var(--bg-elev3)', borderRadius: 100 }}>
                      <div style={{ width: `${(s.plannedMinutes / max) * 100}%`, height: '100%', borderRadius: 100, background: 'var(--border-strong)' }} />
                    </div>
                    <span className="faint" style={{ width: 76, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>予定 {formatMinutesTile(s.plannedMinutes)}</span>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <div style={{ flex: 1, height: 7, background: 'var(--bg-elev3)', borderRadius: 100 }}>
                      <div style={{ width: `${(s.actualMinutes / max) * 100}%`, height: '100%', borderRadius: 100, background: subject?.color ?? 'var(--accent)' }} />
                    </div>
                    <span className="faint" style={{ width: 76, textAlign: 'right' }}>実績 {formatMinutes(s.actualMinutes)}</span>
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      {/* 苦手ランキング */}
      {weakRanking.length > 0 && (
        <>
          <div className="section-label">要注意科目ランキング</div>
          <div className="card">
            {weakRanking.map((s, i) => {
              const subject = state.subjects.find((x) => x.id === s.subjectId);
              return (
                <div key={s.subjectId} className="row" style={{ marginBottom: i < weakRanking.length - 1 ? 12 : 0 }}>
                  <span style={{ fontSize: 19 }}>{['🥇', '🥈', '🥉'][i]}</span>
                  <span style={{ fontWeight: 800, fontSize: 14.5, color: subject?.color }}>{subject?.name}</span>
                  <span className="faint" style={{ marginLeft: 'auto', textAlign: 'right' }}>
                    達成率{Math.round(s.completionRate * 100)}%{s.avgAccuracy !== null && ` / 正答率${Math.round(s.avgAccuracy)}%`}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 教材別進捗と見込み */}
      <div className="section-label">教材別の完了見込み</div>
      {a.materialForecasts.map((f) => {
        const m = state.materials.find((x) => x.id === f.materialId);
        if (!m) return null;
        const subject = state.subjects.find((x) => x.id === m.subjectId);
        const rate = m.totalAmount > 0 ? m.doneAmount / m.totalAmount : 0;
        return (
          <div className="card" key={f.materialId} style={{ padding: 13 }}>
            <div className="row spread">
              <span style={{ fontSize: 14, fontWeight: 800 }}>{m.name}</span>
              <span
                className={`status-badge ${
                  f.status === 'risk' ? 'status-danger' : f.status === 'behind' ? 'status-warn' : 'status-ok'
                }`}
              >
                {f.status === 'risk' ? '危険' : f.status === 'behind' ? '遅れ' : f.status === 'ahead' ? '余裕' : '順調'}
              </span>
            </div>
            <div className="mt-8">
              <ProgressBar value={rate} color={subject?.color} />
            </div>
            <div className="row spread mt-8">
              <span className="faint">
                {f.projectedFinishDate ? `見込み ${formatDateShort(f.projectedFinishDate)}` : '実績データ待ち'} / 目標{' '}
                {formatDateShort(m.targetDate)}
              </span>
              <span className="faint">必要ペース {f.requiredPacePerDay}{m.unit}/日</span>
            </div>
          </div>
        );
      })}

      {/* ペース不足教材 */}
      {slowMaterials.length > 0 && (
        <>
          <div className="section-label">ペースが足りない教材</div>
          <div className="card" style={{ borderColor: 'var(--warn)' }}>
            {slowMaterials.map((f, i) => {
              const m = state.materials.find((x) => x.id === f.materialId);
              return (
                <p key={f.materialId} style={{ fontSize: 13.5, lineHeight: 1.6, marginTop: i === 0 ? 0 : 8 }}>
                  ・<b>{m?.name}</b>: 実績 {f.currentPacePerDay}{m?.unit}/日 → 必要 {f.requiredPacePerDay}
                  {m?.unit}/日
                </p>
              );
            })}
          </div>
        </>
      )}

      {/* ヒートマップ */}
      <div className="section-label">学習ヒートマップ(12週)</div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <div className="heatmap-grid" role="img" aria-label="直近12週間の学習時間ヒートマップ">
          {a.heatmap.map((h) => {
            const intensity = h.minutes / maxHeat;
            const bg =
              h.minutes === 0
                ? 'var(--bg-elev3)'
                : `rgba(79, 124, 255, ${0.25 + intensity * 0.75})`;
            return <div key={h.date} className="heatmap-cell" style={{ background: bg }} title={`${h.date} ${formatMinutes(h.minutes)}`} />;
          })}
        </div>
        <div className="row spread mt-8">
          <span className="faint">12週間前</span>
          <span className="faint">今日</span>
        </div>
      </div>
    </div>
  );
}
