import assert from 'node:assert/strict';
import { addDays, today } from '../src/lib/date';
import { recordAmountInputLimit } from '../src/lib/recordEditCapacity';
import { emptyState } from '../src/state/AppContext';
import type { AppState, Material, StudySession, StudyTask } from '../src/types';

const ref = today();
const now = new Date().toISOString();
const base = emptyState();
const material: Material = {
  id: 'material',
  subjectId: 'subject',
  name: '問題集',
  unit: '問題',
  totalAmount: 100,
  totalUnits: 100,
  doneAmount: 85,
  completedRanges: [{ start: 1, end: 85 }],
  startDate: ref,
  targetDate: addDays(ref, 30),
  priority: 3,
  difficulty: 3,
  minutesPerUnit: 10,
  unitStep: 1,
  splittable: true,
  preferredCadence: { type: 'auto' },
  dailyTarget: null,
  weeklyTarget: null,
  deadlinePolicy: 'normal',
  examRelevance: 3,
  reviewEnabled: false,
  reviewIntervals: [1, 3, 7],
  paused: false,
  round: 1,
  archived: false,
  createdAt: now,
};
const task: StudyTask = {
  id: 'task',
  subjectId: 'subject',
  materialId: material.id,
  title: material.name,
  rangeLabel: '81〜90',
  rangeStart: 81,
  rangeEnd: 90,
  materialRange: { start: 81, end: 90 },
  amount: 10,
  estimatedMinutes: 100,
  priority: 50,
  dueDate: material.targetDate,
  type: 'new',
  status: 'done',
  scheduledDate: ref,
  scheduledStart: '09:00',
  scheduledEnd: '10:40',
  generatedBy: 'auto',
  reviewStage: null,
  createdAt: now,
  updatedAt: now,
  completedAt: now,
  sourceType: 'material',
  sourceId: material.id,
  placementStatus: 'scheduled',
  placementLock: 'none',
};
const session: StudySession = {
  id: 'edited-session',
  taskId: task.id,
  subjectId: 'subject',
  materialId: material.id,
  date: ref,
  startedAt: now,
  minutes: 50,
  amountDone: 5,
  rangeLabel: task.rangeLabel,
  focus: 3,
  memo: '',
  source: 'manual',
  progressRangesAdded: [{ start: 81, end: 85 }],
  taskSnapshotBefore: task,
  completedTask: false,
  updatedAt: now,
};
const state: AppState = {
  ...base,
  onboarded: true,
  subjects: [{ id: 'subject', name: '数学', color: '#4f7cff', importance: 3, weakness: 3 }],
  materials: [material],
  sessions: [session],
  tasks: [],
};

assert.equal(
  recordAmountInputLimit(state, material.id, session),
  20,
  '自由記録の編集では自分の5問を戻し、既存値5問+現在残量15問まで入力できる',
);
assert.equal(
  recordAmountInputLimit(state, material.id, session, task),
  10,
  'タスク記録の編集では差し戻し後も元タスク81〜90の10問を上限にする',
);

const overlappingSession: StudySession = {
  ...session,
  id: 'other-session',
  taskId: null,
  progressRangesAdded: [{ start: 83, end: 85 }],
  amountDone: 3,
};
const overlappingState: AppState = { ...state, sessions: [session, overlappingSession] };
assert.equal(
  recordAmountInputLimit(overlappingState, material.id, session),
  17,
  '別記録も同じ範囲へ寄与する不整合データでは、その3問を未完了として過剰に空けない',
);

const legacySession: StudySession = {
  ...session,
  id: 'legacy-session',
  amountDone: 18,
  progressRangesAdded: undefined,
};
assert.equal(
  recordAmountInputLimit({ ...state, sessions: [legacySession] }, material.id, legacySession),
  18,
  '寄与範囲のない旧記録は現在の残量より大きくても既存入力値を維持できる',
);

console.log('✅ record edit capacity regressions passed');
