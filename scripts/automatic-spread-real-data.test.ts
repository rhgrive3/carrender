import assert from 'node:assert/strict';
import {
  applyAutomaticSpreadCaps,
  computeMaterialSpreadScore,
  generateWithAutomaticSpreadCaps,
} from '../src/lib/automaticSpreadCaps';
import { generatePlanV2 } from '../src/lib/schedulerV2';
import { emptyState } from '../src/state/AppContext';
import type { AppState, Material, SchedulerContext } from '../src/types';

const now = new Date('2026-07-15T07:48:51.976Z'); // バックアップの最終計画生成時刻
const context: SchedulerContext = {
  now,
  timezone: 'Asia/Tokyo',
  generationId: 'real-data-auto-spread',
  maxSearchMilliseconds: 60_000,
  maxSearchNodes: 400_000,
};

const base = emptyState();
const subjects = [
  { id: 'math', name: '数学', color: '#4f7cff', importance: 3 as const, weakness: 3 as const },
  { id: 'english', name: '英語', color: '#00b894', importance: 3 as const, weakness: 3 as const },
  { id: 'physics', name: '物理', color: '#ff7043', importance: 3 as const, weakness: 3 as const },
  { id: 'chemistry', name: '化学', color: '#e84393', importance: 3 as const, weakness: 3 as const },
];

function material(
  id: string,
  name: string,
  subjectId: string,
  total: number,
  done: number,
  minutesPerUnit: number,
  targetDate: string,
  deadlinePolicy: Material['deadlinePolicy'],
  completedRanges: Material['completedRanges'] = done > 0 ? [{ start: 1, end: done }] : [],
): Material {
  return {
    id,
    subjectId,
    name,
    unit: '単位',
    totalAmount: total,
    totalUnits: total,
    doneAmount: done,
    completedRanges,
    startDate: '2026-07-08',
    targetDate,
    priority: 3,
    difficulty: 3,
    minutesPerUnit,
    dailyTarget: null,
    weeklyTarget: null,
    deadlinePolicy,
    examRelevance: 3,
    reviewEnabled: true,
    reviewIntervals: [1, 3, 7, 14, 30],
    paused: false,
    round: 1,
    archived: false,
    unitStep: 1,
    splittable: true,
    preferredCadence: { type: 'auto' },
    estimateMode: 'suggest',
    minimumChunkUnits: 1,
    createdAt: '2026-07-08T12:37:15.202Z',
  };
}

// 2026-07-15の利用者バックアップから、履歴・認証などスケジューラに無関係な項目だけを除いた実入力。
const materials: Material[] = [
  material('math-zx', '数学ZX', 'math', 72, 0, 30, '2026-08-27', 'normal'),
  material('math-xs', '数学XS', 'math', 90, 0, 25, '2026-08-27', 'flexible'),
  material('ham', 'ハム数', 'math', 16, 0, 30, '2026-08-27', 'normal'),
  material('math-3c', '数学特講ⅢC', 'math', 24, 3, 40, '2026-07-21', 'strict', [{ start: 1, end: 3 }]),
  material('chem-1', '化学特講Ⅰ', 'chemistry', 22, 10, 25, '2026-07-17', 'normal', [{ start: 1, end: 9 }, { start: 13, end: 13 }]),
  material('physics-takai', '物理高井', 'physics', 73, 2, 70, '2026-08-27', 'normal', [{ start: 1, end: 2 }]),
  material('reading-s', '英文読解S', 'english', 5, 0, 60, '2026-08-27', 'normal'),
  material('super-writing', 'スーパー英語Ⅱ(英作文)', 'english', 8, 2, 45, '2026-08-04', 'strict', [{ start: 1, end: 2 }]),
  material('super-reading', 'スーパー英語Ⅰ(英文解釈)', 'english', 5, 1, 50, '2026-08-03', 'normal', [{ start: 1, end: 1 }]),
  material('translation-s', '和文英訳S', 'english', 9, 0, 30, '2026-08-27', 'normal'),
  material('long-writing-s', '長文英作S', 'english', 9, 0, 50, '2026-08-27', 'normal'),
  material('syntax-s', '英語構文S', 'english', 10, 0, 50, '2026-08-27', 'normal'),
  material('grammar-s', '英文法S', 'english', 22, 0, 40, '2026-08-27', 'normal'),
  material('practice', '実践テスト', 'english', 11, 0, 30, '2026-08-27', 'normal'),
  material('omo-eigo', 'おも英', 'english', 300, 44, 20, '2026-08-27', 'normal', [{ start: 1, end: 44 }]),
];

const state: AppState = {
  ...base,
  onboarded: true,
  goal: { id: 'summer', name: '夏期期間終了', examDate: '2026-08-27', createdAt: '2026-07-08T12:37:15.202Z' },
  subjects,
  materials,
  tasks: [],
  sessions: [],
  planHistory: [],
  availability: [
    { weekday: 0, minutes: 600, windows: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '19:00' }, { start: '20:00', end: '22:00' }] },
    { weekday: 1, minutes: 660, windows: [{ start: '09:00', end: '12:00' }, { start: '13:30', end: '19:30' }, { start: '20:30', end: '22:30' }] },
    { weekday: 2, minutes: 720, windows: [{ start: '09:00', end: '12:30' }, { start: '13:30', end: '19:00' }, { start: '20:00', end: '23:00' }] },
    { weekday: 3, minutes: 720, windows: [{ start: '09:00', end: '12:30' }, { start: '13:30', end: '19:30' }, { start: '20:30', end: '23:00' }] },
    { weekday: 4, minutes: 720, windows: [{ start: '09:00', end: '12:30' }, { start: '13:30', end: '19:30' }, { start: '20:30', end: '23:00' }] },
    { weekday: 5, minutes: 720, windows: [{ start: '09:00', end: '12:30' }, { start: '13:30', end: '19:30' }, { start: '20:30', end: '23:00' }] },
    { weekday: 6, minutes: 660, windows: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '19:00' }, { start: '20:00', end: '23:00' }] },
  ],
  fixedEvents: [
    ...['2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25'].map((date, index) => ({
      id: `math-course-${index}`, title: '数学特講ⅢC', weekday: null, date,
      start: '09:00', end: '12:50', startDate: null, endDate: null,
    })),
    ...['2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08'].map((date, index) => ({
      id: `english-course-${index}`, title: 'スーパー英語Ⅰ Ⅱ', weekday: null, date,
      start: '10:00', end: '16:30', startDate: null, endDate: null,
    })),
    {
      id: 'chem-course', title: '化学特講Ⅰ', weekday: null, date: null,
      startDate: '2026-07-15', endDate: '2026-07-18', start: '09:00', end: '12:55',
    },
  ],
  dayPlans: [],
  settings: {
    ...base.settings,
    maxDailyMinutes: 630,
    sessionMinMinutes: 25,
    sessionMaxMinutes: 90,
    weeklyTargetMinutes: 2700,
    taskGenerationHorizonDays: 7,
    estimateAlpha: 0.2,
    reviewRule: { enabled: false, intervals: [1, 3, 7, 14, 30] },
  },
};

const applied = applyAutomaticSpreadCaps(state, context);
const capByMaterial = new Map(applied.caps.map((cap) => [cap.materialId, cap]));
assert.equal(capByMaterial.get('super-writing')?.maxUnitsPerDay, 2, '英作文は1日2セクション=90分を自動上限にする');
assert.equal(capByMaterial.get('chem-1')?.maxUnitsPerDay, 6, '短期限教材は安全完了に必要な6単位/日まで自動緩和する');
assert.equal(capByMaterial.get('physics-takai')?.maxUnitsPerDay, 2, '長期の70分教材は1日2単位までに抑える');

const baseline = generatePlanV2(state, context);
const capped = generatePlanV2(applied.state, context);
const chosen = generateWithAutomaticSpreadCaps(state, context, generatePlanV2);
const baselineScore = computeMaterialSpreadScore(baseline);
const cappedScore = computeMaterialSpreadScore(capped);
const chosenScore = computeMaterialSpreadScore(chosen);

const materialStats = (result: typeof baseline, materialId: string) => {
  const tasks = result.scheduledTasks.filter((task) => task.materialId === materialId && task.status === 'planned');
  const byDate = new Map<string, number>();
  for (const task of tasks) byDate.set(task.scheduledDate, (byDate.get(task.scheduledDate) ?? 0) + task.estimatedMinutes);
  return {
    days: byDate.size,
    maxDayMinutes: Math.max(0, ...byDate.values()),
    dates: Object.fromEntries([...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
};
const baselineSuper = materialStats(baseline, 'super-writing');
const cappedSuper = materialStats(capped, 'super-writing');

assert.ok(capped.objectiveReport.strictDeadlineViolations <= baseline.objectiveReport.strictDeadlineViolations, '厳守期限違反を増やさない');
assert.ok(capped.objectiveReport.unscheduledStrictMinutes <= baseline.objectiveReport.unscheduledStrictMinutes, '厳守未配置を増やさない');
assert.ok(capped.objectiveReport.unscheduledMinutes <= baseline.objectiveReport.unscheduledMinutes, '全体未配置時間を増やさない');
assert.ok(cappedSuper.days >= 3, `英作文6セクションを3日以上へ分散する: ${JSON.stringify(cappedSuper)}`);
assert.ok(cappedSuper.maxDayMinutes <= 90, `英作文の1日最大を90分以下にする: ${JSON.stringify(cappedSuper)}`);
assert.ok(cappedScore.sameDayExtraChunks < baselineScore.sameDayExtraChunks, `${JSON.stringify({ baselineScore, cappedScore })}`);
assert.deepEqual(chosenScore, cappedScore, '上位保証が同等なら分散した候補を採用する');

console.log('✅ automatic spread real-data comparison passed', JSON.stringify({
  baseline: { status: baseline.status, objective: baseline.objectiveReport, spread: baselineScore, superWriting: baselineSuper },
  capped: { status: capped.status, objective: capped.objectiveReport, spread: cappedScore, superWriting: cappedSuper },
  caps: applied.caps,
}));
