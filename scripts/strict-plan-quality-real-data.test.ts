import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generatePlanV2 } from '../src/lib/schedulerRecovery';
import { summarizeMaterialConcentration } from '../src/lib/materialScheduleSmoothing';
import { validateGeneratedScheduleV2 } from '../src/lib/schedulerV2';
import type { AppState, SchedulerContext, StudyTask } from '../src/types';

const TARGET_MATERIAL_ID = 'mat_mrc2brcy_g_f0j1';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/strict-plan-quality-state.json', import.meta.url), 'utf8')) as AppState;
const context: SchedulerContext = {
  now: new Date('2026-07-18T06:44:07.326Z'),
  timezone: 'Asia/Tokyo',
  generationId: 'strict-plan-quality-real-data',
};

function targetTasks(tasks: StudyTask[]): StudyTask[] {
  return tasks
    .filter((task) => task.materialId === TARGET_MATERIAL_ID && task.type === 'new')
    .sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate)
      || (left.scheduledStart ?? '').localeCompare(right.scheduledStart ?? '')
      || left.id.localeCompare(right.id));
}

const result = generatePlanV2(fixture, context);
assert.equal(result.status, 'success', '実データ由来の混雑計画を探索上限内で確定する');
assert.equal(result.objectiveReport.strictDeadlineViolations, 0, '厳守期限違反を出さない');
assert.equal(result.objectiveReport.unscheduledStrictMinutes, 0, '厳守教材を未配置にしない');
assert.deepEqual(validateGeneratedScheduleV2(fixture, result, context), [], '生成後の全制約検証を通す');

const composition = targetTasks(result.scheduledTasks);
assert.equal(composition.length, 3, '残り6セクションを90分×3セッションで生成する');
assert.equal(composition.reduce((sum, task) => sum + task.estimatedMinutes, 0), 270, '残り所要時間270分を欠落・重複なく配置する');
assert.deepEqual(
  composition.map((task) => task.materialRange),
  [{ start: 3, end: 4 }, { start: 5, end: 6 }, { start: 7, end: 8 }],
  '教材範囲を実行日時の昇順でも3〜4→5〜6→7〜8に保つ',
);
assert.deepEqual(
  composition.map((task) => task.scheduledDate),
  ['2026-07-20', '2026-07-21', '2026-07-22'],
  '締切日へ集中させず、実バックアップで確保可能な3日へ1セッションずつ分散する',
);
assert.ok(composition.every((task) => task.scheduledDate < '2026-08-04'), '締切当日まで先送りしない');

const concentration = summarizeMaterialConcentration(result.scheduledTasks, TARGET_MATERIAL_ID);
assert.deepEqual(
  concentration,
  { activeDays: 3, sameDayExcess: 0, maxDayMinutes: 90 },
  '英作文の進捗グラフを3日分散・1日最大90分にする',
);

const rerun = generatePlanV2(fixture, context);
assert.deepEqual(
  targetTasks(rerun.scheduledTasks).map((task) => ({
    range: task.materialRange,
    date: task.scheduledDate,
    start: task.scheduledStart,
    end: task.scheduledEnd,
  })),
  composition.map((task) => ({
    range: task.materialRange,
    date: task.scheduledDate,
    start: task.scheduledStart,
    end: task.scheduledEnd,
  })),
  '同じ入力では厳守教材の配置を揺らさない',
);

console.log('✅ strict real-data plan quality regressions passed');
