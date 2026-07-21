import assert from 'node:assert/strict';
import type { AppState, Material } from '../src/types';
import { emptyState, appReducer } from '../src/state/AppContext';
import { generatePlanV2 } from '../src/lib/schedulerRecovery';
import { validateMaterialIntegrity } from '../src/lib/materialIntegrity';

// Keep the UI/reducer boundary and the production scheduler entry on the same
// integer and finite-number contract so persisted legacy data cannot bypass it.
const material = (overrides: Partial<Material> = {}): Material => ({
  id: 'material-integrity',
  subjectId: 'subject-1',
  name: '整合性教材',
  unit: '問題',
  totalAmount: 100,
  totalUnits: 100,
  doneAmount: 10,
  completedRanges: [{ start: 1, end: 10 }],
  startDate: '2026-07-22',
  targetDate: '2026-08-22',
  priority: 3,
  difficulty: 3,
  minutesPerUnit: 2.5,
  unitStep: 1,
  minimumChunkUnits: 1,
  maximumChunkUnits: 10,
  splittable: true,
  preferredCadence: { type: 'timesPerWeek', count: 3 },
  dailyTarget: null,
  weeklyTarget: null,
  deadlinePolicy: 'normal',
  examRelevance: 3,
  reviewEnabled: true,
  reviewIntervals: [1, 3, 7],
  paused: false,
  round: 1,
  archived: false,
  createdAt: '2026-07-22T00:00:00.000Z',
  ...overrides,
});

assert.deepEqual(validateMaterialIntegrity(material()), [], '正常な整数数量と小数の所要時間を受理する');

const invalidCases: Array<[string, Material, string]> = [
  ['小数総量', material({ totalAmount: 10.5, totalUnits: 10.5 }), 'totalAmount'],
  ['小数完了量', material({ doneAmount: 1.5, completedRanges: undefined }), 'doneAmount'],
  ['小数刻み', material({ unitStep: 0.5 }), 'unitStep'],
  ['NaN刻み', material({ unitStep: Number.NaN }), 'unitStep'],
  ['Infinity刻み', material({ unitStep: Number.POSITIVE_INFINITY }), 'unitStep'],
  ['小数最小チャンク', material({ minimumChunkUnits: 1.5 }), 'minimumChunkUnits'],
  ['小数日別単位上限', material({ maxUnitsPerDay: 2.5 }), 'maxUnitsPerDay'],
  ['NaN所要時間', material({ minutesPerUnit: Number.NaN }), 'minutesPerUnit'],
  ['Infinity日別時間上限', material({ maxMinutesPerDay: Number.POSITIVE_INFINITY }), 'maxMinutesPerDay'],
  ['NaN日目標', material({ dailyTarget: Number.NaN }), 'dailyTarget'],
  ['総量互換値不一致', material({ totalUnits: 99 }), 'totalUnits'],
  ['完了範囲不一致', material({ doneAmount: 9 }), 'completedRanges'],
  ['週回数範囲外', material({ preferredCadence: { type: 'timesPerWeek', count: 8 } }), 'preferredCadence.count'],
  ['復習間隔小数', material({ reviewIntervals: [1, 2.5] }), 'reviewIntervals'],
];

for (const [label, candidate, field] of invalidCases) {
  const issues = validateMaterialIntegrity(candidate);
  assert.ok(issues.some((entry) => entry.field === field), `${label}を${field}のエラーとして拒否する`);
}

const base: AppState = {
  ...emptyState(),
  onboarded: true,
  goal: { id: 'goal-1', name: '試験', examDate: '2026-09-30', createdAt: '2026-07-22T00:00:00.000Z' },
  subjects: [{ id: 'subject-1', name: '数学', color: '#3366ff', importance: 3, weakness: 3 }],
};
const invalidMaterial = material({ totalAmount: 10.5, totalUnits: 10.5, doneAmount: 0, completedRanges: [] });
const reduced = appReducer(base, { type: 'ADD_MATERIAL', material: invalidMaterial });
assert.strictEqual(reduced, base, '不正教材のADD_MATERIALではAppStateを変更しない');

const schedule = generatePlanV2({ ...base, materials: [invalidMaterial] }, {
  now: new Date('2026-07-22T09:00:00+09:00'),
  timezone: 'Asia/Tokyo',
  generationId: 'material-integrity-test',
});
assert.equal(schedule.status, 'invalidInput', '計画入口でも不正教材を拒否する');
assert.ok(schedule.validationErrors.some((entry) => entry.targetId === invalidMaterial.id && entry.field === 'totalAmount'));
assert.equal(schedule.scheduledTasks.length, 0, '不正教材から部分的な予定を生成しない');

console.log('✅ material domain integrity tests passed');
await import('./deep-ux-audit-367-369.test');
