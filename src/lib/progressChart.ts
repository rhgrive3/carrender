import type { ISODate, Material, StudySession, StudyTask } from '../types';
import { addDays, diffDays } from './date';

function materialStartDate(material: Material): ISODate {
  return material.startDate || material.createdAt.slice(0, 10);
}

/**
 * 完了時に保存したタスクスナップショットを、分析上の不変な計画値として使う。
 * 再計算後に同じIDの表示用タスクが変化しても、完了済み作業の当初予定を改変しない。
 */
export function stablePlanTasks(tasks: StudyTask[], sessions: StudySession[]): StudyTask[] {
  const snapshots = new Map<string, StudyTask>();
  for (const session of [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    const snapshot = session.completedTask ? session.taskSnapshotBefore : undefined;
    if (snapshot && !snapshots.has(snapshot.id)) snapshots.set(snapshot.id, snapshot);
  }
  if (snapshots.size === 0) return tasks;
  return [
    ...tasks.filter((task) => !snapshots.has(task.id)),
    ...snapshots.values(),
  ];
}

/**
 * 長期間でも日単位の変化を優先し、実績日・予定日は必ず点として残す。
 * 2年を超える場合だけ描画負荷を抑えるため基準点を間引く。
 */
export function buildProgressChartDates(
  materials: Material[],
  refDate: ISODate,
  plannedDates: ISODate[],
  actualDates: ISODate[],
): ISODate[] {
  const allDates = [
    refDate,
    ...materials.flatMap((material) => [materialStartDate(material), material.targetDate]),
    ...plannedDates,
    ...actualDates,
  ];
  const start = allDates.reduce((min, date) => date < min ? date : min, refDate);
  const end = allDates.reduce((max, date) => date > max ? date : max, refDate);
  const span = Math.max(0, diffDays(start, end));
  const step = span > 730 ? 7 : span > 365 ? 2 : 1;
  const dates = new Set<ISODate>();
  for (let index = 0; index <= span; index += step) dates.add(addDays(start, index));
  for (const date of allDates) dates.add(date);
  return [...dates].sort();
}
