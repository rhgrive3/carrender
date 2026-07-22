import assert from 'node:assert/strict';
import { addDays, today } from '../src/lib/date';
import { appReducer, emptyState, resolveAppAction } from '../src/state/AppContext';
import type { AppState, StudyTask } from '../src/types';

const date = today();
const now = '2026-07-22T00:00:00.000Z';
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

const postponeAction = { type: 'POSTPONE_TASK' as const, taskId: doingTask.id };
const resolvedPostpone = resolveAppAction(state, postponeAction, { nowIso: now, todayDate: date });
assert.equal(resolvedPostpone.status, 'ready');
assert.equal(resolvedPostpone.status === 'ready' ? resolvedPostpone.action.type : undefined, 'UPDATE_TASK');

const postponed = appReducer(state, postponeAction);
assert.notStrictEqual(postponed, state, 'Reducer直接実行でもUI commandと同じstale doing復旧を行う');
assert.equal(postponed.tasks[0]?.status, 'planned');
assert.equal(postponed.tasks[0]?.scheduledDate, addDays(date, 1));
assert.notEqual(postponed.tasks[0]?.scheduledStart, '09:00', '古い固定時刻を維持しない');

const moveDate = addDays(date, 2);
const moveAction = { type: 'MOVE_TASK' as const, taskId: doingTask.id, date: moveDate };
const resolvedMove = resolveAppAction(state, moveAction, { nowIso: now, todayDate: date });
assert.equal(resolvedMove.status, 'ready');
const moved = appReducer(state, moveAction);
assert.equal(moved.tasks[0]?.status, 'planned');
assert.equal(moved.tasks[0]?.scheduledDate, moveDate);
assert.equal(moved.tasks[0]?.placementLock, 'date');

const updated = appReducer(state, {
  type: 'UPDATE_TASK',
  task: { ...doingTask, scheduledDate: addDays(date, 1), updatedAt: now },
});
assert.notStrictEqual(updated, state, 'UPDATE_TASKもdoingをplannedへ正規化して入口差を作らない');
assert.equal(updated.tasks[0]?.status, 'planned');

const deleted = resolveAppAction(state, { type: 'DELETE_TASK', taskId: doingTask.id });
assert.equal(deleted.status, 'noChange', 'stale doingの削除は状態変更なしとして型で区別する');
assert.strictEqual(appReducer(state, { type: 'DELETE_TASK', taskId: doingTask.id }), state);

const activeTimerTarget = {
  owner: 'owner',
  taskId: doingTask.id,
  subjectId: doingTask.subjectId,
  materialId: doingTask.materialId,
  sourceId: doingTask.sourceId,
  rangeStart: doingTask.rangeStart,
  rangeEnd: doingTask.rangeEnd,
};
const rejected = resolveAppAction(state, postponeAction, { activeTimerTarget });
assert.equal(rejected.status, 'rejected', '実際のactive timer対象はstale doing復旧せず拒否する');
assert.equal(rejected.status === 'rejected' ? rejected.errorCode : undefined, 'activeTaskMutation');

const dueTodayTask: StudyTask = {
  ...doingTask,
  id: 'due-today',
  sourceId: 'due-today',
  status: 'planned',
  dueDate: date,
};
const dueTodayState: AppState = { ...state, tasks: [dueTodayTask], planHistory: [{ id: 'history', createdAt: now, reason: 'fixture', tasks: [] }] };
const dueTodayAction = { type: 'POSTPONE_TASK' as const, taskId: dueTodayTask.id };
const dueTodayResolved = resolveAppAction(dueTodayState, dueTodayAction, { nowIso: now, todayDate: date });
assert.equal(dueTodayResolved.status, 'rejected', '今日期限のタスクを期限翌日へ延期しない');
assert.equal(dueTodayResolved.status === 'rejected' ? dueTodayResolved.errorCode : undefined, 'pastDueDate');
assert.equal(dueTodayResolved.status === 'rejected' ? dueTodayResolved.message : undefined, '期限を過ぎる日には移動できません');
assert.strictEqual(appReducer(dueTodayState, dueTodayAction), dueTodayState, '拒否時はtask・履歴・updatedAtを一切変更しない');

const staleDoingDueTodayState: AppState = { ...state, tasks: [{ ...doingTask, dueDate: date }] };
const staleDoingDueToday = resolveAppAction(staleDoingDueTodayState, postponeAction, { nowIso: now, todayDate: date });
assert.equal(staleDoingDueToday.status, 'rejected', 'stale doing復旧でも期限翌日へ固定しない');
assert.equal(staleDoingDueToday.status === 'rejected' ? staleDoingDueToday.errorCode : undefined, 'pastDueDate');

const dueTomorrowTask: StudyTask = { ...dueTodayTask, id: 'due-tomorrow', sourceId: 'due-tomorrow', dueDate: addDays(date, 1) };
const dueTomorrowState: AppState = { ...state, tasks: [dueTomorrowTask] };
const dueTomorrowResult = resolveAppAction(
  dueTomorrowState,
  { type: 'POSTPONE_TASK', taskId: dueTomorrowTask.id },
  { nowIso: now, todayDate: date },
);
assert.equal(dueTomorrowResult.status, 'ready', '期限当日への延期は許可する');
const dueTomorrowPostponed = appReducer(dueTomorrowState, { type: 'POSTPONE_TASK', taskId: dueTomorrowTask.id });
assert.equal(dueTomorrowPostponed.tasks[0]?.scheduledDate, addDays(date, 1));

const overdueTask: StudyTask = { ...dueTodayTask, id: 'overdue', sourceId: 'overdue', dueDate: addDays(date, -1) };
const overdueState: AppState = { ...state, tasks: [overdueTask] };
const overdueResult = resolveAppAction(
  overdueState,
  { type: 'POSTPONE_TASK', taskId: overdueTask.id },
  { nowIso: now, todayDate: date },
);
assert.equal(overdueResult.status, 'ready', '既に期限切れのタスクは復旧目的で延期できる');

console.log('✅ unified app command semantics and postpone deadline guards passed');
