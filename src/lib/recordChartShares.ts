export function recordChartSharePercent(minutes: number, totalMinutes: number): number {
  const value = Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
  const total = Number.isFinite(totalMinutes) ? Math.max(0, totalMinutes) : 0;
  if (total <= 0 || value <= 0) return 0;
  return Math.min(100, (value / total) * 100);
}
