import { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AppState, ISODate, Material } from '../../types';
import { addDays, diffDays, formatDateShort } from '../../lib/date';

interface GoalProgressChartProps {
  state: AppState;
  refDate: ISODate;
}

type ChartPoint = {
  date: ISODate;
  label: string;
  [key: string]: number | string | null;
};

type Series = {
  key: string;
  name: string;
  materialName: string;
  color: string;
  kind: 'target' | 'actual';
};

const FALLBACK_COLORS = ['#4f7cff', '#00b894', '#9a5cff', '#ff7043', '#e84393', '#00a8cc', '#fbc531', '#2ecc8f'];

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function materialStartDate(material: Material): ISODate {
  return material.startDate || material.createdAt.slice(0, 10);
}

function buildDateRange(materials: Material[], refDate: ISODate): ISODate[] {
  const start = materials.reduce<ISODate>((min, material) => {
    const d = materialStartDate(material);
    return d < min ? d : min;
  }, refDate);
  const end = materials.reduce<ISODate>((max, material) => {
    return material.targetDate > max ? material.targetDate : max;
  }, refDate);

  const span = Math.max(0, diffDays(start, end));
  const step = span > 240 ? 7 : span > 120 ? 3 : 1;
  const dates = new Set<ISODate>();
  for (let i = 0; i <= span; i += step) {
    dates.add(addDays(start, i));
  }
  dates.add(refDate);
  for (const material of materials) {
    dates.add(materialStartDate(material));
    dates.add(material.targetDate);
  }
  return [...dates].sort();
}

export function GoalProgressChart({ state, refDate }: GoalProgressChartProps) {
  const chart = useMemo(() => {
    const activeMaterials = state.materials
      .filter((material) => !material.archived && !material.paused && material.totalAmount > 0)
      .sort((a, b) => a.targetDate.localeCompare(b.targetDate) || b.priority - a.priority);

    if (activeMaterials.length === 0) {
      return { points: [] as ChartPoint[], series: [] as Series[], materials: [] as Material[] };
    }

    const dates = buildDateRange(activeMaterials, refDate);
    const sessionsByMaterial = new Map<string, { date: ISODate; amount: number }[]>();
    for (const session of state.sessions) {
      if (!session.materialId || session.amountDone <= 0) continue;
      const list = sessionsByMaterial.get(session.materialId) ?? [];
      list.push({ date: session.date, amount: session.amountDone });
      sessionsByMaterial.set(session.materialId, list);
    }
    for (const list of sessionsByMaterial.values()) {
      list.sort((a, b) => a.date.localeCompare(b.date));
    }

    const series: Series[] = [];
    activeMaterials.forEach((material, index) => {
      const subject = state.subjects.find((s) => s.id === material.subjectId);
      const color = subject?.color ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
      series.push({
        key: `m${index}Target`,
        name: `${material.name} 目標`,
        materialName: material.name,
        color,
        kind: 'target',
      });
      series.push({
        key: `m${index}Actual`,
        name: `${material.name} 実績`,
        materialName: material.name,
        color,
        kind: 'actual',
      });
    });

    const totalRecordedByMaterial = new Map<string, number>();
    for (const [materialId, list] of sessionsByMaterial) {
      totalRecordedByMaterial.set(
        materialId,
        list.reduce((sum, item) => sum + item.amount, 0),
      );
    }

    const points: ChartPoint[] = dates.map((date) => {
      const point: ChartPoint = { date, label: formatDateShort(date) };

      activeMaterials.forEach((material, index) => {
        const start = materialStartDate(material);
        const targetSpan = Math.max(1, diffDays(start, material.targetDate));
        const targetElapsed = diffDays(start, date);
        point[`m${index}Target`] = clampPercent((targetElapsed / targetSpan) * 100);

        if (date > refDate) {
          point[`m${index}Actual`] = null;
          return;
        }

        const recorded = sessionsByMaterial.get(material.id) ?? [];
        const baseline = Math.max(0, material.doneAmount - (totalRecordedByMaterial.get(material.id) ?? 0));
        const doneByDate =
          baseline +
          recorded.reduce((sum, item) => {
            return item.date <= date ? sum + item.amount : sum;
          }, 0);
        point[`m${index}Actual`] = clampPercent((doneByDate / material.totalAmount) * 100);
      });

      return point;
    });

    return { points, series, materials: activeMaterials };
  }, [refDate, state.materials, state.sessions, state.subjects]);

  if (chart.points.length === 0) {
    return (
      <div className="card">
        <p className="faint">教材を追加すると、目標達成率と実績達成率の推移が表示されます。</p>
      </div>
    );
  }

  const currentCount = chart.materials.filter((material) => material.doneAmount < material.totalAmount).length;

  return (
    <div className="card progress-chart-card">
      <div className="row spread progress-chart-head">
        <div>
          <div className="progress-chart-title">課題別 達成目標と実績</div>
          <div className="faint">点線が目標、実線が実績。縦軸は達成率です。</div>
        </div>
        <div className="progress-chart-kpi">
          <span>{currentCount}</span>
          <small>進行中</small>
        </div>
      </div>

      <div className="progress-chart-wrap" role="img" aria-label="日付ごとの教材別目標達成率と実績達成率の折れ線グラフ">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chart.points} margin={{ top: 12, right: 16, bottom: 4, left: -8 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
            <XAxis
              dataKey="date"
              minTickGap={28}
              tickFormatter={formatDateShort}
              tick={{ fill: 'var(--text-faint)', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border-strong)' }}
            />
            <YAxis
              domain={[0, 100]}
              tickCount={6}
              tickFormatter={(value) => `${value}%`}
              tick={{ fill: 'var(--text-faint)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={42}
            />
            <ReferenceLine y={100} stroke="var(--ok)" strokeDasharray="4 4" strokeOpacity={0.6} />
            <ReferenceLine x={refDate} stroke="var(--warn)" strokeDasharray="4 4" strokeOpacity={0.65} />
            <Tooltip content={<ProgressTooltip series={chart.series} />} />
            <Legend content={<ProgressLegend series={chart.series} />} />
            {chart.series.map((item) => (
              <Line
                key={item.key}
                type="monotone"
                dataKey={item.key}
                name={item.name}
                stroke={item.color}
                strokeWidth={item.kind === 'actual' ? 2.4 : 1.7}
                strokeDasharray={item.kind === 'target' ? '7 6' : undefined}
                dot={false}
                activeDot={item.kind === 'actual' ? { r: 4, strokeWidth: 0 } : { r: 3, strokeWidth: 0 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ProgressTooltip({
  active,
  label,
  payload,
  series,
}: {
  active?: boolean;
  label?: string;
  payload?: { dataKey?: string | number; value?: number | string; color?: string }[];
  series: Series[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const byKey = new Map(series.map((item) => [item.key, item]));
  const rows = payload
    .filter((item) => typeof item.value === 'number')
    .map((item) => ({ item, meta: byKey.get(String(item.dataKey)) }))
    .filter((row): row is { item: { value: number; color?: string }; meta: Series } => Boolean(row.meta))
    .sort((a, b) => a.meta.materialName.localeCompare(b.meta.materialName) || a.meta.kind.localeCompare(b.meta.kind));

  return (
    <div className="progress-chart-tooltip">
      <div className="progress-chart-tooltip-date">{label}</div>
      {rows.map(({ item, meta }) => (
        <div key={`${meta.key}-${item.value}`} className="progress-chart-tooltip-row">
          <span className="progress-chart-tooltip-dot" style={{ background: meta.color }} />
          <span className="progress-chart-tooltip-name">
            {meta.materialName} {meta.kind === 'target' ? '目標' : '実績'}
          </span>
          <span className="progress-chart-tooltip-value">{Math.round(Number(item.value))}%</span>
        </div>
      ))}
    </div>
  );
}

function ProgressLegend({ series }: { series: Series[] }) {
  const materials = series.filter((item) => item.kind === 'actual');
  return (
    <div className="progress-chart-legend">
      {materials.map((item) => (
        <span key={item.key} className="progress-chart-legend-item">
          <span className="progress-chart-legend-line" style={{ background: item.color }} />
          {item.materialName}
        </span>
      ))}
      <span className="progress-chart-legend-item muted-legend">
        <span className="progress-chart-legend-dash" />
        目標
      </span>
      <span className="progress-chart-legend-item muted-legend">
        <span className="progress-chart-legend-line solid" />
        実績
      </span>
    </div>
  );
}
