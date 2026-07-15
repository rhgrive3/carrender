import type { AppState, ISODate } from '../types';
import { addDays } from './date';
import { compactPlanRevisions } from './planHistory';
import type { PlanRevision } from './planHistory';

export interface HistoricalMonthSummary {
  month: string;
  studyMinutes: number;
  sessionCount: number;
  completedTaskCount: number;
  plannedMinutes: number;
  missedMinutes: number;
  subjectMinutes: { subjectId: string; minutes: number }[];
}

type SettingsWithHistory = AppState['settings'] & {
  historyData?: {
    planRevisions: PlanRevision[];
    monthlySummaries: HistoricalMonthSummary[];
  };
};

export const DETAIL_HISTORY_RETENTION_DAYS = 365;

function monthKey(date: ISODate): string {
  return date.slice(0, 7);
}

function summaryFor(map: Map<string, HistoricalMonthSummary>, month: string): HistoricalMonthSummary {
  const existing = map.get(month);
  if (existing) return existing;
  const created: HistoricalMonthSummary = {
    month,
    studyMinutes: 0,
    sessionCount: 0,
    completedTaskCount: 0,
    plannedMinutes: 0,
    missedMinutes: 0,
    subjectMinutes: [],
  };
  map.set(month, created);
  return created;
}

function addSubjectMinutes(summary: HistoricalMonthSummary, subjectId: string, minutes: number): void {
  const current = new Map(summary.subjectMinutes.map((item) => [item.subjectId, item.minutes]));
  current.set(subjectId, (current.get(subjectId) ?? 0) + minutes);
  summary.subjectMinutes = [...current.entries()]
    .map(([id, value]) => ({ subjectId: id, minutes: value }))
    .sort((left, right) => left.subjectId.localeCompare(right.subjectId));
}

/**
 * 直近1年は編集可能な詳細データとして保持し、それより古い完了履歴は
 * 月次集計へ圧縮する。進行中・未完了タスクは日付に関係なく残す。
 */
export function applyOneYearHistoryRetention(state: AppState, refDate: ISODate): AppState {
  const cutoff = addDays(refDate, -DETAIL_HISTORY_RETENTION_DAYS);
  const settings = state.settings as SettingsWithHistory;
  const historyData = settings.historyData ?? { planRevisions: [], monthlySummaries: [] };
  const summaries = new Map<string, HistoricalMonthSummary>(
    historyData.monthlySummaries.map((summary) => [summary.month, { ...summary, subjectMinutes: [...summary.subjectMinutes] }]),
  );

  const sessions = [] as AppState['sessions'];
  for (const session of state.sessions) {
    if (session.date >= cutoff) {
      sessions.push(session);
      continue;
    }
    const summary = summaryFor(summaries, monthKey(session.date));
    summary.studyMinutes += session.minutes;
    summary.sessionCount += 1;
    addSubjectMinutes(summary, session.subjectId, session.minutes);
  }

  const tasks = [] as AppState['tasks'];
  for (const task of state.tasks) {
    const terminal = task.status === 'done' || task.status === 'skipped';
    if (!terminal || task.scheduledDate >= cutoff) {
      tasks.push(task);
      continue;
    }
    const summary = summaryFor(summaries, monthKey(task.scheduledDate));
    summary.plannedMinutes += task.estimatedMinutes;
    if (task.status === 'done') summary.completedTaskCount += 1;
  }

  const planHistory = [] as NonNullable<AppState['planHistory']>;
  for (const entry of state.planHistory ?? []) {
    if (entry.scheduledDate >= cutoff) {
      planHistory.push(entry);
      continue;
    }
    const summary = summaryFor(summaries, monthKey(entry.scheduledDate));
    summary.plannedMinutes += entry.estimatedMinutes;
    summary.missedMinutes += entry.estimatedMinutes;
  }

  const monthlySummaries = [...summaries.values()]
    .map((summary) => ({
      ...summary,
      studyMinutes: Math.max(0, Math.round(summary.studyMinutes)),
      sessionCount: Math.max(0, Math.round(summary.sessionCount)),
      completedTaskCount: Math.max(0, Math.round(summary.completedTaskCount)),
      plannedMinutes: Math.max(0, Math.round(summary.plannedMinutes)),
      missedMinutes: Math.max(0, Math.round(summary.missedMinutes)),
      subjectMinutes: summary.subjectMinutes.map((item) => ({ ...item, minutes: Math.max(0, Math.round(item.minutes)) })),
    }))
    .sort((left, right) => left.month.localeCompare(right.month));

  const planRevisions = compactPlanRevisions(historyData.planRevisions, new Date(`${refDate}T12:00:00+09:00`));
  if (sessions.length === state.sessions.length
    && tasks.length === state.tasks.length
    && planHistory.length === (state.planHistory ?? []).length
    && planRevisions.length === historyData.planRevisions.length
    && monthlySummaries.length === historyData.monthlySummaries.length) return state;

  return {
    ...state,
    sessions,
    tasks,
    planHistory,
    settings: {
      ...state.settings,
      historyData: { planRevisions, monthlySummaries },
    } as SettingsWithHistory,
  };
}
