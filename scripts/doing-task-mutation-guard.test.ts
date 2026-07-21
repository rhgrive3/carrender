import assert from 'node:assert/strict';
import { addDays, today } from '../src/lib/date';
import { appReducer, emptyState } from '../src/state/AppContext';
import type { AppState, StudyTask } from '../src/types';

const date = today();
const now = new Date().toISOString();
const doingTask: StudyTask = {
  id: 'doing-task', subjectId: 'subject', materialId: null, title: '計測中タスク', rangeLabel: '',
  rangeStart: null, rangeEnd: null, amount: 1, estimatedMinutes: 30, priority: 50, dueDate: addDays(date, 7),
  type: 'new', status: 'doing', scheduledDate: date, scheduledStart: '09:00', scheduledEnd: '09:30',
  generatedBy: 'manual', reviewStage: null, createdAt: now, updatedAt: now, completedAt: null,
  sourceType: 'manual', sourceId: 'doing-task', placementStatus: 'scheduled', placementLock: 'time',
  manualScheduling: {
    placementPolicy: 'fixedTime',
    fixedDate: date,
    fixedStartTime: '09:00',
    progressPolicy: { type: 'independent' },
    splittable: false,
  },
};
const state: AppState = {
  ...emptyState(), onboarded: true,
  subjects: [{ id: 'subject', name: '数学', color: '#4f7cff', importance: 3, weakness: 3 }],
  tasks: [doingTask],
};

assert.strictEqual(
  appReducer(state, { type: 'POSTPONE_TASK', taskId: doingTask.id }),
  state,
  '計測中タスクはReducer境界でも延期しない',
);
assert.strictEqual(
  appReducer(state, { type: 'MOVE_TASK', taskId: doingTask.id, date: addDays(date, 1) }),
  state,
  '計測中タスクはReducer境界でも別日へ移動しない',
);
assert.strictEqual(
  appReducer(state, {
    type: 'UPDATE_TASK',
    task: { ...doingTask, scheduledDate: addDays(date, 1), updatedAt: new Date().toISOString() },
  }),
  state,
  '計測中タスクはUPDATE_TASK経由でも予定を変更しない',
);
assert.strictEqual(
  appReducer(state, { type: 'DELETE_TASK', taskId: doingTask.id }),
  state,
  '計測中タスクはReducer境界でも削除しない',
);

const recovered = appReducer(state, {
  type: 'UPDATE_TASK',
  task: {
    ...doingTask,
    status: 'planned',
    placementLock: 'none',
    scheduledStart: null,
    scheduledEnd: null,
    manualScheduling: {
      ...doingTask.manualScheduling!,
      placementPolicy: 'flexibleBeforeDeadline',
      fixedDate: undefined,
      fixedStartTime: undefined,
    },
    updatedAt: new Date().toISOString(),
  },
});
assert.notStrictEqual(recovered, state, '古いdoing状態はplannedへ戻す同一更新で復旧できる');
assert.equal(recovered.tasks[0]?.status, 'planned');

console.log('✅ doing task mutation guards passed');
