import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reconcileCompletedMaterialProgress } from '../src/lib/materialProgressIntegrity';
import { adjustCompletedRanges, emptyState } from '../src/state/AppContext';
import type { AppState, Material, StudyTask } from '../src/types';

const now = '2026-07-15T12:14:42.000Z';
const material: Material = {
  id: 'mat_math_special',
  subjectId: 'subj_math',
  name: '数学特講1A2BC',
  unit: '問題',
  totalAmount: 32,
  totalUnits: 32,
  doneAmount: 28,
  completedRanges: [{ start: 1, end: 25 }, { start: 27, end: 29 }],
  startDate: '2026-07-08',
  targetDate: '2026-08-27',
  priority: 3,
  difficulty: 3,
  minutesPerUnit: 30,
  dailyTarget: null,
  weeklyTarget: null,
  deadlinePolicy: 'normal',
  examRelevance: 3,
  reviewEnabled: false,
  reviewIntervals: [1, 3, 7],
  paused: false,
  round: 1,
  archived: false,
  unitStep: 1,
  splittable: true,
  preferredCadence: { type: 'auto' },
  estimateMode: 'suggest',
  createdAt: now,
};

function task(id: string, over: Partial<StudyTask>): StudyTask {
  return {
    id,
    subjectId: 'subj_math',
    materialId: material.id,
    title: material.name,
    rangeLabel: '',
    rangeStart: null,
    rangeEnd: null,
    amount: 1,
    estimatedMinutes: 30,
    priority: 80,
    dueDate: '2026-08-27',
    type: 'new',
    status: 'planned',
    scheduledDate: '2026-07-15',
    scheduledStart: null,
    scheduledEnd: null,
    generatedBy: 'auto',
    memo: '',
    reviewStage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    sourceType: 'material',
    sourceId: material.id,
    placementStatus: 'unscheduled',
    placementLock: 'none',
    ...over,
  };
}

const base: AppState = {
  ...emptyState(),
  onboarded: true,
  subjects: [{ id: 'subj_math', name: '数学', color: '#4f7cff', importance: 3, weakness: 3 }],
  materials: [material],
  tasks: [
    task('legacy_done_24_26', {
      status: 'done',
      completedAt: '2026-07-09T07:14:25.261Z',
      rangeStart: 24,
      rangeEnd: 26,
      materialRange: { start: 24, end: 26 },
      amount: 3,
    }),
    task('planned_30_32', {
      rangeStart: 30,
      rangeEnd: 32,
      materialRange: { start: 30, end: 32 },
      amount: 3,
      estimatedMinutes: 90,
    }),
    task('done_review_must_not_count', {
      type: 'review',
      status: 'done',
      completedAt: now,
      sourceType: 'review',
      rangeStart: 30,
      rangeEnd: 32,
      materialRange: { start: 30, end: 32 },
      amount: 3,
    }),
    task('done_manual_must_not_count', {
      status: 'done',
      completedAt: now,
      generatedBy: 'manual',
      sourceType: 'manual',
      sourceId: 'manual_source',
      rangeStart: 30,
      rangeEnd: 32,
      materialRange: { start: 30, end: 32 },
      amount: 3,
    }),
  ],
};

const repaired = reconcileCompletedMaterialProgress(base);
assert.equal(repaired.repairs.length, 1, '不整合のある教材だけを修復する');
assert.deepEqual(repaired.state.materials[0].completedRanges, [{ start: 1, end: 29 }], '完了扱いだった24〜26のうち欠落した26を復元する');
assert.equal(repaired.state.materials[0].doneAmount, 29, '28/32から29/32へ修復する');
assert.equal(repaired.repairs[0].recoveredUnits, 1, '実データで隠れていた1問だけを追加する');
assert.ok(repaired.state.materials[0].doneAmount < 32, '未完了の30〜32は勝手に完了へしない');

const finalState: AppState = {
  ...repaired.state,
  tasks: [...repaired.state.tasks, task('done_30_32', {
    status: 'done',
    completedAt: now,
    rangeStart: 30,
    rangeEnd: 32,
    materialRange: { start: 30, end: 32 },
    amount: 3,
  })],
};
const completed = reconcileCompletedMaterialProgress(finalState);
assert.equal(completed.state.materials[0].doneAmount, 32, '残り30〜32の完了後は32/32へ到達できる');
assert.equal(completed.state.materials[0].doneAmount / completed.state.materials[0].totalAmount, 1, '進捗が100%へ到達する');

const idempotent = reconcileCompletedMaterialProgress(repaired.state);
assert.equal(idempotent.repairs.length, 0, '修復済みデータを繰り返し変更しない');
assert.equal(idempotent.state, repaired.state, '変更不要ならstate参照を維持する');

assert.deepEqual(
  adjustCompletedRanges(10, [{ start: 1, end: 2 }, { start: 5, end: 6 }], 6),
  [{ start: 1, end: 6 }],
  '完了量を増やす時は飛び飛び範囲を維持しつつ先頭の未完了範囲から追加する',
);
assert.deepEqual(
  adjustCompletedRanges(10, [{ start: 1, end: 2 }, { start: 5, end: 6 }], 2),
  [{ start: 1, end: 2 }],
  '完了量を減らす時は後方の完了範囲から削る',
);
assert.deepEqual(
  adjustCompletedRanges(8, [{ start: 1, end: 3 }, { start: 8, end: 10 }], 4),
  [{ start: 1, end: 3 }, { start: 8, end: 8 }],
  '総量を縮小した時は範囲外だけを切り捨てる',
);
assert.deepEqual(adjustCompletedRanges(10, [], 3), [{ start: 1, end: 3 }], '新規教材は先頭から完了範囲を作る');

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
assert.match(appSource, /<MaterialProgressIntegrityBridge\s*\/>/, '端末・クラウド読込後に自動修復を実行する');

console.log('✅ material progress integrity regressions passed');
