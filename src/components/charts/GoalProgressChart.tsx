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

const MATERIAL_LINE_COLORS = [
  '#2f80ed',
  '#00a676',
  '#f2994a',
  '#eb5757',
  '#9b51e0',
  '#00a8cc',
  '#f2c94c',
  '#27ae60',
  '#ff5c8a',
  '#56ccf2',
  '#bb6bd9',
  '#6fcf97',
];

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function materialStartDate(material: Material): ISODate {
  return material.startDate || material.createdAt.slice(0, 10);
}

function buildDateRange(materials: Material[], refDate: ISODate, plannedDates: ISODate[]): ISODate[] {
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
  for (const date of plannedDates) {
    dates.add(date);
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

    const plannedByMaterial = new Map<string, { date: ISODate; amount: number }[]>();
    for (const task of state.tasks) {
      if (!task.materialId || task.type !== 'new' || task.status === 'skipped' || task.amount <= 0) continue;
      const list = plannedByMaterial.get(task.materialId) ?? [];
      list.push({ date: task.scheduledDate, amount: task.amount });
      plannedByMaterial.set(task.materialId, list);
    }
    for (const list of plannedByMaterial.values()) {
      list.sort((a, b) => a.date.localeCompare(b.date));
    }

    const plannedDates = [...plannedByMaterial.values()].flatMap((list) => list.map((item) => item.date));
    const dates = buildDateRange(activeMaterials, refDate, plannedDates);
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
      const color = MATERIAL_LINE_COLORS[index % MATERIAL_LINE_COLORS.length];
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
        const baseline = Math.max(0, material.doneAmount - (totalRecordedByMaterial.get(material.id) ?? 0));
        const planned = plannedByMaterial.get(material.id) ?? [];
        const plannedByDate =
          baseline +
          planned.reduce((sum, item) => {
            return item.date <= date ? sum + item.amount : sum;
          }, 0);
        point[`m${index}Target`] = date < start ? 0 : clampPercent((plannedByDate / material.totalAmount) * 100);

        if (date > refDate) {
          point[`m${index}Actual`] = null;
          return;
        }

        const recorded = sessionsByMaterial.get(material.id) ?? [];
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
  }, [refDate, state.materials, state.sessions, state.tasks]);

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
            <Tooltip
              allowEscapeViewBox={{ x: true, y: true }}
              content={<ProgressTooltip series={chart.series} />}
              wrapperStyle={{
                zIndex: 30,
                maxHeight: 'calc(100dvh - var(--safe-top) - var(--safe-bottom) - 96px)',
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch',
              }}
            />
            <Legend content={<ProgressLegend series={chart.series} />} />
            {chart.series.map((item) => (
              <Line
                key={item.key}
                type={item.kind === 'target' ? 'stepAfter' : 'monotone'}
                dataKey={item.key}
                name={item.name}
                stroke={item.color}
                strokeWidth={item.kind === 'actual' ? 2.8 : 1.6}
                strokeDasharray={item.kind === 'target' ? '7 6' : undefined}
                strokeOpacity={item.kind === 'target' ? 0.48 : 0.96}
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
  const grouped = new Map<string, { color: string; target: number | null; actual: number | null }>();
  for (const { item, meta } of rows) {
    const current = grouped.get(meta.materialName) ?? { color: meta.color, target: null, actual: null };
    current[meta.kind] = item.value;
    grouped.set(meta.materialName, current);
  }

  return (
    <div className="progress-chart-tooltip">
      <div className="progress-chart-tooltip-date">{label}</div>
      {[...grouped.entries()].map(([name, values]) => (
        <div key={name} className="progress-chart-tooltip-item">
          <div className="progress-chart-tooltip-material">
            <span className="progress-chart-tooltip-dot" style={{ background: values.color }} />
            <span className="progress-chart-tooltip-name">{name}</span>
          </div>
          <div className="progress-chart-tooltip-values">
            <span>目標 {values.target === null ? '-' : `${Math.round(values.target)}%`}</span>
            <span>実績 {values.actual === null ? '-' : `${Math.round(values.actual)}%`}</span>
          </div>
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
