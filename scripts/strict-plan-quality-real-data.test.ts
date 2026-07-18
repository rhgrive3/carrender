import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generatePlan } from '../src/lib/scheduler';
import { summarizeMaterialConcentration } from '../src/lib/materialScheduleSmoothing';
import { validateGeneratedScheduleV2 } from '../src/lib/schedulerV2';
import type { AppState, SchedulerContext, StudyTask } from '../src/types';

const MATH_MATERIAL_ID = 'mat_mrc2brcy_c_gfcb';
const COMPOSITION_MATERIAL_ID = 'mat_mrc2brcy_g_f0j1';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/strict-plan-quality-state.json', import.meta.url), 'utf8')) as AppState;
const context: SchedulerContext = {
  // PR #232後の実バックアップが生成された時刻。15:44時点の旧fixtureでは
  // 当日容量が多く、17:04時点で発生する全strictロールバックを再現できなかった。
  now: new Date('2026-07-18T08:04:52.050Z'),
  timezone: 'Asia/Tokyo',
  generationId: 'strict-plan-quality-real-data-app-path',
};

function materialTasks(tasks: StudyTask[], materialId: string): StudyTask[] {
  return tasks
    .filter((task) => task.materialId === materialId && task.type === 'new' && task.status === 'planned')
    .sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate)
      || (left.scheduledStart ?? '').localeCompare(right.scheduledStart ?? '')
      || left.id.localeCompare(right.id));
}

function minutesByDate(tasks: StudyTask[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const task of tasks) result[task.scheduledDate] = (result[task.scheduledDate] ?? 0) + task.estimatedMinutes;
  return result;
}

function generateThroughAppPath() {
  const generated = generatePlan(fixture, '2026-07-18', '厳守教材の実データ回帰', {
    now: context.now,
    timezone: context.timezone,
    generationId: context.generationId,
  });
  const schedule = generated.state.lastScheduleResult;
  assert.ok(schedule, '実アプリのgeneratePlan経路でスケジュール結果を保存する');
  return { state: generated.state, schedule };
}

const { state, schedule } = generateThroughAppPath();
assert.equal(schedule.status, 'success', '実データ由来の複数strict計画を探索上限内で確定する');
assert.equal(schedule.objectiveReport.strictDeadlineViolations, 0, '厳守期限違反を出さない');
assert.equal(schedule.objectiveReport.unscheduledStrictMinutes, 0, '厳守教材を未配置にしない');
assert.equal(schedule.objectiveReport.safetyBufferViolationMinutes, 0, '安全完了日の予備を壊さない');
assert.deepEqual(validateGeneratedScheduleV2(fixture, schedule, context), [], '生成後の全制約検証を通す');

const math = materialTasks(state.tasks, MATH_MATERIAL_ID);
assert.equal(math.length, 11, '数ⅢCの残り21問を80分×10件+40分×1件で生成する');
assert.equal(math.reduce((sum, task) => sum + task.estimatedMinutes, 0), 840, '数ⅢCの残り840分を欠落・重複なく配置する');
assert.deepEqual(
  minutesByDate(math),
  {
    '2026-07-18': 240,
    '2026-07-19': 240,
    '2026-07-20': 240,
    '2026-07-21': 120,
  },
  '数ⅢCを期限前4日へ240・240・240・120分で分散する',
);
assert.deepEqual(
  math.map((task) => task.materialRange),
  [
    { start: 4, end: 5 }, { start: 6, end: 7 }, { start: 8, end: 9 },
    { start: 10, end: 11 }, { start: 12, end: 13 }, { start: 14, end: 15 },
    { start: 16, end: 17 }, { start: 18, end: 19 }, { start: 20, end: 21 },
    { start: 22, end: 23 }, { start: 24, end: 24 },
  ],
  '数ⅢCの範囲を実行日時の昇順でも4〜5から24まで維持する',
);
const mathConcentration = summarizeMaterialConcentration(schedule.scheduledTasks, MATH_MATERIAL_ID);
assert.deepEqual(
  mathConcentration,
  { activeDays: 4, sameDayExcess: 7, maxDayMinutes: 240 },
  '数ⅢCを7月20〜21の240・600分へ戻さず、1日最大240分に抑える',
);

const composition = materialTasks(state.tasks, COMPOSITION_MATERIAL_ID);
assert.equal(composition.length, 3, '英作文の残り6セクションを90分×3セッションで生成する');
assert.equal(composition.reduce((sum, task) => sum + task.estimatedMinutes, 0), 270, '英作文の残り270分を欠落・重複なく配置する');
assert.deepEqual(
  composition.map((task) => task.materialRange),
  [{ start: 3, end: 4 }, { start: 5, end: 6 }, { start: 7, end: 8 }],
  '英作文の範囲を3〜4→5〜6→7〜8に保つ',
);
assert.deepEqual(
  composition.map((task) => task.scheduledDate),
  ['2026-07-21', '2026-07-22', '2026-07-23'],
  '英作文を締切日の8月4日ではなく、数ⅢC後の3日へ1セッションずつ分散する',
);
assert.ok(composition.every((task) => task.scheduledDate < '2026-08-04'), '英作文を締切当日まで先送りしない');
assert.deepEqual(
  summarizeMaterialConcentration(schedule.scheduledTasks, COMPOSITION_MATERIAL_ID),
  { activeDays: 3, sameDayExcess: 0, maxDayMinutes: 90 },
  '英作文の進捗グラフを3日分散・1日最大90分にする',
);

const rerun = generateThroughAppPath();
for (const materialId of [MATH_MATERIAL_ID, COMPOSITION_MATERIAL_ID]) {
  assert.deepEqual(
    materialTasks(rerun.state.tasks, materialId).map((task) => ({
      range: task.materialRange,
      date: task.scheduledDate,
      start: task.scheduledStart,
      end: task.scheduledEnd,
    })),
    materialTasks(state.tasks, materialId).map((task) => ({
      range: task.materialRange,
      date: task.scheduledDate,
      start: task.scheduledStart,
      end: task.scheduledEnd,
    })),
    `同じ入力では${materialId}の配置を揺らさない`,
  );
}

console.log('✅ strict real-data app-path plan quality regressions passed');
