import { lazy, Suspense, useMemo } from 'react';
import { ArrowRight, CircleCheck, Clock3, Gauge, Lightbulb, TriangleAlert, TrendingUp } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { computeAnalytics } from '../lib/analytics';
import { diffDays, formatDateShort, formatHoursShort, formatMinutes, formatMinutesTile, today } from '../lib/date';
import { ProgressBar, EmptyState } from '../components/ui/bits';
import type { ShellTab } from '../lib/shellNavigation';

const GoalProgressChart = lazy(() =>
  import('../components/charts/GoalProgressChart').then((module) => ({ default: module.GoalProgressChart })),
);

interface Insight {
  id: string;
  tone: 'critical' | 'warning' | 'neutral' | 'success';
  title: string;
  body: string;
  action?: string;
  tab?: ShellTab;
}

export function AnalyticsScreen({ onNavigate }: { onNavigate?: (tab: ShellTab) => void }) {
  const { state } = useApp();
  const t = today();
  const analytics = useMemo(() => computeAnalytics(state, t), [state, t]);
  const daysLeft = state.goal ? diffDays(t, state.goal.examDate) : null;
  const capacityRate = analytics.capacity.totalAvailableMinutes > 0
    ? Math.min(1, analytics.capacity.totalRemainingMinutes / analytics.capacity.totalAvailableMinutes)
    : 0;
  const slowMaterials = analytics.materialForecasts.filter(
    (forecast) => forecast.remainingAmount > 0
      && forecast.currentPacePerDay > 0
      && forecast.currentPacePerDay < forecast.requiredPacePerDay * 0.7,
  );
  const weakestSubject = [...analytics.subjectStats]
    .filter((subject) => subject.plannedMinutes > 0)
    .sort((a, b) => a.completionRate - b.completionRate)[0];
  const maxHeat = Math.max(30, ...analytics.heatmap.map((item) => item.minutes));

  const insights = useMemo<Insight[]>(() => {
    const result: Insight[] = [];
    if (!analytics.capacity.ok) {
      result.push({
        id: 'capacity',
        tone: 'critical',
        title: `期限までに${formatMinutes(analytics.capacity.deficitMinutes)}不足する見込みです`,
        body: '学習可能時間を追加するか、優先度の低い教材を調整すると計画を戻せます。',
        action: '計画を調整',
        tab: 'plan',
      });
    }

    const slow = slowMaterials[0];
    if (slow) {
      const material = state.materials.find((item) => item.id === slow.materialId);
      if (material) {
        result.push({
          id: `slow-${material.id}`,
          tone: slow.status === 'risk' ? 'critical' : 'warning',
          title: `${material.name}の進みが必要ペースを下回っています`,
          body: `現在は1日${slow.currentPacePerDay}${material.unit}、必要なペースは${slow.requiredPacePerDay}${material.unit}です。`,
          action: '教材を見る',
          tab: 'materials',
        });
      }
    }

    if (weakestSubject && weakestSubject.completionRate < 0.85) {
      const subject = state.subjects.find((item) => item.id === weakestSubject.subjectId);
      if (subject) {
        result.push({
          id: `subject-${subject.id}`,
          tone: weakestSubject.completionRate < 0.6 ? 'warning' : 'neutral',
          title: `${subject.name}の予定達成率は${Math.round(weakestSubject.completionRate * 100)}%です`,
          body: '未完了分を次の空き時間へ移すと、科目の偏りを小さくできます。',
          action: '予定を確認',
          tab: 'plan',
        });
      }
    }

    if (result.length === 0) {
      result.push({
        id: 'on-track',
        tone: 'success',
        title: '今のペースで期限に間に合う見込みです',
        body: analytics.comments[0] ?? '大きな調整は必要ありません。今日の予定を続けましょう。',
        action: '今日の学習へ',
        tab: 'today',
      });
    }

    for (const [index, comment] of analytics.comments.entries()) {
      if (result.length >= 3) break;
      if (result.some((item) => item.body.includes(comment))) continue;
      result.push({ id: `comment-${index}`, tone: 'neutral', title: comment, body: '直近の予定と実績から算出しています。' });
    }
    return result.slice(0, 3);
  }, [analytics.capacity, analytics.comments, slowMaterials, state.materials, state.subjects, weakestSubject]);

  if (state.sessions.length === 0 && state.tasks.length === 0) {
    return (
      <div className="screen analytics-v2">
        <div className="screen-header"><div><h1 className="screen-title">振り返り</h1><div className="screen-sub">次の改善につながる提案</div></div></div>
        <EmptyState icon="📊" title="分析するデータがまだありません">
          勉強を記録すると、期限の見込みと改善案がここに表示されます。
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="screen analytics-v2">
      <div className="screen-header">
        <div><h1 className="screen-title">振り返り</h1><div className="screen-sub">見るだけで終わらない、次の改善</div></div>
      </div>

      <section className="analytics-outlook" aria-labelledby="outlook-title">
        <div className="analytics-outlook-copy">
          <span className="section-kicker">完了見込み</span>
          <h2 id="outlook-title">{analytics.capacity.ok ? '期限に間に合う見込みです' : '学習時間の調整が必要です'}</h2>
          <p>
            必要 {formatHoursShort(analytics.capacity.totalRemainingMinutes)} / 確保できる {formatHoursShort(analytics.capacity.totalAvailableMinutes)}
            {daysLeft !== null && ` · あと${daysLeft}日`}
          </p>
        </div>
        <span className={`analytics-outlook-icon ${analytics.capacity.ok ? 'success' : 'critical'}`} aria-hidden="true">
          {analytics.capacity.ok ? <CircleCheck size={26} /> : <TriangleAlert size={26} />}
        </span>
        <div className="analytics-outlook-progress"><ProgressBar value={capacityRate} color={analytics.capacity.ok ? 'var(--ok)' : 'var(--danger)'} /></div>
      </section>

      <section className="analytics-actions" aria-labelledby="insights-title">
        <div className="today-section-heading">
          <div><span className="section-kicker">優先順</span><h2 id="insights-title">今やると効果が大きいこと</h2></div>
        </div>
        <div className="insight-list">
          {insights.map((insight) => (
            <article className={`insight-row ${insight.tone}`} key={insight.id}>
              <span className="insight-indicator" aria-hidden="true">
                {insight.tone === 'critical' || insight.tone === 'warning' ? <TriangleAlert size={18} /> : <Lightbulb size={18} />}
              </span>
              <div className="insight-copy"><h3>{insight.title}</h3><p>{insight.body}</p></div>
              {insight.action && insight.tab && (
                <button className="btn btn-secondary btn-sm" onClick={() => onNavigate?.(insight.tab!)}>
                  {insight.action}<ArrowRight size={14} aria-hidden="true" />
                </button>
              )}
            </article>
          ))}
        </div>
      </section>

      <div className="analytics-kpis" aria-label="学習の概要">
        <div><Gauge size={17} aria-hidden="true" /><span><strong>{Math.round(analytics.planAchievementRate7d * 100)}%</strong><small>7日間の予定達成率</small></span></div>
        <div><TrendingUp size={17} aria-hidden="true" /><span><strong>{analytics.streakDays}日</strong><small>連続学習</small></span></div>
        <div><Clock3 size={17} aria-hidden="true" /><span><strong>{formatMinutesTile(analytics.weekMinutes)}</strong><small>今週の学習</small></span></div>
      </div>

      <details className="analytics-details">
        <summary>データを詳しく見る</summary>
        <div className="analytics-detail-grid">
          <section className="analytics-detail-wide">
            <h2>達成率の推移</h2>
            <Suspense fallback={<div className="card faint">グラフを読み込み中...</div>}>
              <GoalProgressChart state={state} refDate={t} />
            </Suspense>
          </section>

          <section className="analytics-detail-panel">
            <h2>科目の状態</h2>
            <div className="analytics-subject-list">
              {analytics.subjectStats.filter((item) => item.plannedMinutes > 0 || item.actualMinutes > 0).map((item) => {
                const subject = state.subjects.find((candidate) => candidate.id === item.subjectId);
                const tone = item.completionRate < 0.6 ? '要対応' : item.completionRate < 0.85 ? '観察' : '順調';
                return (
                  <div key={item.subjectId}>
                    <span className="subject-dot" style={{ background: subject?.color ?? 'var(--accent)' }} />
                    <span><strong>{subject?.name}</strong><small>予定 {formatMinutes(item.plannedMinutes)} · 実績 {formatMinutes(item.actualMinutes)}</small></span>
                    <b className={`subject-state ${tone === '要対応' ? 'critical' : tone === '観察' ? 'warning' : ''}`}>{tone}</b>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="analytics-detail-panel">
            <h2>教材の完了見込み</h2>
            <div className="analytics-material-list">
              {analytics.materialForecasts.map((forecast) => {
                const material = state.materials.find((item) => item.id === forecast.materialId);
                if (!material) return null;
                return (
                  <div key={forecast.materialId}>
                    <span><strong>{material.name}</strong><small>目標 {formatDateShort(material.targetDate)}</small></span>
                    <b className={forecast.status === 'risk' ? 'critical' : forecast.status === 'behind' ? 'warning' : ''}>
                      {forecast.projectedFinishDate ? formatDateShort(forecast.projectedFinishDate) : '実績待ち'}
                    </b>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="analytics-detail-wide">
            <h2>過去12週間の学習</h2>
            <div className="heatmap-grid" aria-label="学習時間ヒートマップ">
              {analytics.heatmap.map((item) => {
                const level = item.minutes === 0 ? 0 : Math.max(1, Math.ceil((item.minutes / maxHeat) * 4));
                return <div key={item.date} className="heatmap-cell" title={`${formatDateShort(item.date)}: ${formatMinutes(item.minutes)}`} style={{ background: level === 0 ? undefined : `color-mix(in srgb, var(--bg-elev3), var(--accent) ${level * 20}%)` }} />;
              })}
            </div>
          </section>
        </div>
      </details>
    </div>
  );
}
