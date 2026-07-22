import { computeAnalytics } from './analytics';
import {
  addDays,
  formatDateShort,
  formatMinutes,
  monthKeyOf,
  startOfWeek,
  today,
  WEEKDAY_LABELS,
  weekdayOf,
} from './date';
import { stablePlanTasks } from './progressChart';
import { resolveRecordSubject } from './recordSubjects';
import { loadState } from './storage';
import {
  actualMaterialAmountThrough,
  isPlacedPlanTask,
  legacyProgressBaselineRanges,
  plannedMaterialAmountThrough,
} from './taskFilters';
import type { AppState, ISODate } from '../types';

const INSTALL_KEY = '__studyCommanderChartAccessibleDataGuard';
const GENERATED_SELECTOR = '[data-chart-accessible-data]';

type GuardWindow = Window & { [INSTALL_KEY]?: () => void };

type DaySummary = {
  date: ISODate;
  planned: number;
  actual: number;
  subjects: { name: string; minutes: number }[];
};

function text(element: Element | null): string {
  return element?.textContent?.trim() ?? '';
}

function safeState(): AppState | null {
  try {
    return loadState();
  } catch (error) {
    console.warn('グラフの代替データを読み込めませんでした', error);
    return null;
  }
}

function makeElement<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
}

function appendCell(row: HTMLTableRowElement, value: string, header = false): void {
  const cell = document.createElement(header ? 'th' : 'td');
  cell.textContent = value;
  if (header) cell.setAttribute('scope', 'col');
  row.appendChild(cell);
}

function buildDetails(title: string, description: string, signature: string): HTMLDetailsElement {
  const details = makeElement('details', 'chart-data-alternative');
  details.dataset.chartAccessibleData = signature;
  const summary = makeElement('summary');
  summary.textContent = title;
  details.appendChild(summary);
  const intro = makeElement('p', 'faint');
  intro.textContent = description;
  details.appendChild(intro);
  return details;
}

function replaceGenerated(anchor: Element, signature: string, details: HTMLDetailsElement): void {
  const current = anchor.parentElement?.querySelector<HTMLElement>(`:scope > ${GENERATED_SELECTOR}`);
  if (current?.dataset.chartAccessibleData === signature) return;
  current?.remove();
  anchor.insertAdjacentElement('afterend', details);
}

function displayedWeekStart(): ISODate | null {
  const title = text(document.querySelector('.records-v2 .period-nav b'));
  const reference = today();
  if (title === '今週') return startOfWeek(reference);
  if (title === '先週') return addDays(startOfWeek(reference), -7);
  const match = title.match(/^(\d{1,2})\/(\d{1,2})〜(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  const [, startMonth, startDay, endMonth, endDay] = match.map(Number);
  const currentYear = Number(reference.slice(0, 4));
  const candidates: ISODate[] = [];
  for (const year of [currentYear - 1, currentYear, currentYear + 1]) {
    const start = `${year}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}` as ISODate;
    const expectedEnd = addDays(start, 6);
    if (Number(expectedEnd.slice(5, 7)) === endMonth && Number(expectedEnd.slice(8, 10)) === endDay) candidates.push(start);
  }
  return candidates.sort((a, b) => Math.abs(Date.parse(`${a}T00:00:00`) - Date.parse(`${reference}T00:00:00`)) - Math.abs(Date.parse(`${b}T00:00:00`) - Date.parse(`${reference}T00:00:00`)))[0] ?? null;
}

function summarizeWeek(state: AppState, start: ISODate): DaySummary[] {
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const stableTasks = stablePlanTasks(state.tasks, state.sessions);
  return days.map((date) => {
    const sessions = state.sessions.filter((session) => session.date === date);
    const subjectMinutes = new Map<string, number>();
    for (const session of sessions) subjectMinutes.set(session.subjectId, (subjectMinutes.get(session.subjectId) ?? 0) + session.minutes);
    const plannedFromTasks = stableTasks
      .filter((task) => isPlacedPlanTask(task) && task.scheduledDate === date)
      .reduce((sum, task) => sum + task.estimatedMinutes, 0);
    const plannedFromHistory = (state.planHistory ?? [])
      .filter((entry) => entry.scheduledDate === date)
      .reduce((sum, entry) => sum + entry.estimatedMinutes, 0);
    return {
      date,
      planned: plannedFromTasks + plannedFromHistory,
      actual: sessions.reduce((sum, session) => sum + session.minutes, 0),
      subjects: [...subjectMinutes.entries()]
        .map(([subjectId, minutes]) => ({ name: resolveRecordSubject(state.subjects, subjectId).name, minutes }))
        .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, 'ja')),
    };
  });
}

function installWeekAlternative(state: AppState): void {
  const chart = document.querySelector('.studyplus-chart-card .studyplus-chart');
  if (!chart) return;
  const start = displayedWeekStart();
  if (!start) return;
  const rows = summarizeWeek(state, start);
  const signature = `records-week:${JSON.stringify(rows)}`;
  const details = buildDetails('日別の予定・実績を表で見る', '視覚グラフと同じ期間の日付、予定時間、実績時間、科目別内訳です。', signature);
  const table = makeElement('table');
  table.setAttribute('aria-label', '日別の予定時間・実績時間・科目別内訳');
  const thead = document.createElement('thead');
  const header = document.createElement('tr');
  ['日付', '予定', '実績', '科目別内訳'].forEach((label) => appendCell(header, label, true));
  thead.appendChild(header);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    appendCell(tr, `${formatDateShort(row.date)} (${WEEKDAY_LABELS[weekdayOf(row.date)]})`);
    appendCell(tr, formatMinutes(row.planned));
    appendCell(tr, formatMinutes(row.actual));
    appendCell(tr, row.subjects.length > 0 ? row.subjects.map((item) => `${item.name} ${formatMinutes(item.minutes)}`).join('、') : '記録なし');
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  details.appendChild(table);
  replaceGenerated(chart, signature, details);
  chart.setAttribute('aria-describedby', ensureDescription(chart, 'records-week-chart-summary', `表示期間の予定は合計${formatMinutes(rows.reduce((sum, row) => sum + row.planned, 0))}、実績は合計${formatMinutes(rows.reduce((sum, row) => sum + row.actual, 0))}です。`));
}

function ensureDescription(anchor: Element, id: string, value: string): string {
  let node = document.getElementById(id);
  if (!node) {
    node = makeElement('p', 'sr-only');
    node.id = id;
    anchor.insertAdjacentElement('beforebegin', node);
  }
  if (node.textContent !== value) node.textContent = value;
  return id;
}

function installAnalyticsHeatmapAlternative(state: AppState): void {
  const grid = document.querySelector('.analytics-v2 .heatmap-grid');
  if (!grid) return;
  const heatmap = computeAnalytics(state, today()).heatmap;
  const studied = heatmap.filter((item) => item.minutes > 0);
  const signature = `analytics-heatmap:${JSON.stringify(heatmap)}`;
  const details = buildDetails('過去12週間の学習時間を一覧で見る', `全${heatmap.length}日中、学習記録がある日は${studied.length}日です。`, signature);
  const list = makeElement('ul');
  list.setAttribute('aria-label', '過去12週間の学習日と学習時間');
  if (studied.length === 0) {
    const item = makeElement('li');
    item.textContent = 'この期間に学習記録はありません。';
    list.appendChild(item);
  } else {
    for (const item of studied) {
      const li = makeElement('li');
      li.textContent = `${formatDateShort(item.date)} (${WEEKDAY_LABELS[weekdayOf(item.date)]}) ${formatMinutes(item.minutes)}`;
      list.appendChild(li);
    }
  }
  details.appendChild(list);
  replaceGenerated(grid, signature, details);
  grid.setAttribute('aria-describedby', ensureDescription(grid, 'analytics-heatmap-summary', `過去12週間で${studied.length}日、合計${formatMinutes(studied.reduce((sum, item) => sum + item.minutes, 0))}学習しています。`));
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function installGoalProgressAlternative(state: AppState): void {
  const chart = document.querySelector('.progress-chart-card .progress-chart-wrap');
  if (!chart) return;
  const refDate = today();
  const stableTasks = stablePlanTasks(state.tasks, state.sessions);
  const rows = state.materials
    .filter((material) => !material.archived && !material.paused && material.totalAmount > 0)
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate) || b.priority - a.priority)
    .map((material) => {
      const baselineRanges = legacyProgressBaselineRanges(material, state.sessions);
      const actualRangesThroughDate = state.sessions
        .filter((session) => session.materialId === material.id && session.date <= refDate)
        .flatMap((session) => session.progressRangesAdded ?? []);
      const planned = plannedMaterialAmountThrough(
        stableTasks,
        material.id,
        material.totalAmount,
        refDate,
        baselineRanges,
        state.planHistory ?? [],
        actualRangesThroughDate,
      );
      const actual = actualMaterialAmountThrough(material, state.sessions, refDate);
      return {
        id: material.id,
        name: material.name,
        target: clampPercent((planned / material.totalAmount) * 100),
        actual: clampPercent((actual / material.totalAmount) * 100),
      };
    });
  const signature = `goal-progress:${JSON.stringify(rows)}`;
  const details = buildDetails('教材別の現在達成率を表で見る', `${formatDateShort(refDate)}時点の目標達成率と実績達成率です。`, signature);
  const table = makeElement('table');
  table.setAttribute('aria-label', `${formatDateShort(refDate)}時点の教材別目標達成率と実績達成率`);
  const thead = document.createElement('thead');
  const header = document.createElement('tr');
  ['教材', '目標', '実績', '差'].forEach((label) => appendCell(header, label, true));
  thead.appendChild(header);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    appendCell(tr, row.name);
    appendCell(tr, `${Math.round(row.target)}%`);
    appendCell(tr, `${Math.round(row.actual)}%`);
    appendCell(tr, `${row.actual >= row.target ? '+' : ''}${Math.round(row.actual - row.target)}ポイント`);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  details.appendChild(table);
  replaceGenerated(chart, signature, details);
  const behind = rows.filter((row) => row.actual < row.target).length;
  chart.setAttribute('aria-describedby', ensureDescription(chart, 'goal-progress-chart-summary', `${rows.length}教材中、目標以上が${rows.length - behind}件、目標未満が${behind}件です。`));
}

function normalizeChartAlternatives(): void {
  const state = safeState();
  if (!state) return;
  installWeekAlternative(state);
  installAnalyticsHeatmapAlternative(state);
  installGoalProgressAlternative(state);
}

/**
 * 視覚グラフのhover・色・高さへ閉じ込められた数値を、同じ端末stateから
 * 折りたたみ可能な表・一覧として再構成する。React画面の期間切替やlazy描画後も追従する。
 */
export function installChartAccessibleDataGuard(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  const guardWindow = window as GuardWindow;
  if (guardWindow[INSTALL_KEY]) return guardWindow[INSTALL_KEY]!;
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      normalizeChartAlternatives();
    });
  };
  schedule();
  const observer = new MutationObserver((records) => {
    if (records.every((record) => record.target instanceof Element && record.target.closest(GENERATED_SELECTOR))) return;
    schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  const cleanup = () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    delete guardWindow[INSTALL_KEY];
  };
  guardWindow[INSTALL_KEY] = cleanup;
  return cleanup;
}
