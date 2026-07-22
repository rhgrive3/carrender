import assert from 'node:assert/strict';
import type { StudySession, StudyTask } from '../src/types';
import {
  parsePersistedTimerTarget,
  timerTargetMatchesSession,
  timerTargetMatchesSessionInput,
  timerTargetMatchesTask,
  timerTargetsSameWork,
} from '../src/lib/timerTargetIdentity';

const target = {
  taskId: 'old-task-id',
  materialId: 'material-1',
  sourceId: 'source-1',
  range: { start: 11, end: 20 },
  type: 'new' as const,
};

const regeneratedTask = {
  id: 'new-task-id',
  materialId: 'material-1',
  sourceId: 'source-1',
  materialRange: { start: 11, end: 20 },
  type: 'new',
} as StudyTask;
assert.equal(timerTargetMatchesTask(target, regeneratedTask), true, 'task ID変更後もsource/material/rangeで復旧する');
assert.equal(timerTargetMatchesTask(target, { ...regeneratedTask, materialId: 'material-2' }), false, '別教材を誤一致しない');
assert.equal(timerTargetMatchesTask(target, { ...regeneratedTask, materialRange: { start: 21, end: 30 } }), false, '別範囲を誤一致しない');
assert.equal(timerTargetMatchesTask(target, { ...regeneratedTask, type: 'review' }), false, '別種別を誤一致しない');

assert.equal(timerTargetMatchesSessionInput(target, {
  taskId: null,
  materialId: 'material-1',
  taskLocator: { sourceId: 'source-1', range: { start: 11, end: 20 }, type: 'new' },
}), true, '記録入力も同じcanonical locatorで一致する');

const historicalSession = {
  taskId: null,
  taskSnapshotBefore: regeneratedTask,
} as StudySession;
assert.equal(timerTargetMatchesSession(target, historicalSession), true, 'task参照解除後もsnapshotから同じ作業を保護する');

assert.equal(timerTargetsSameWork(
  { taskId: 'stable-id', materialId: 'material-1' },
  { taskId: 'stable-id', materialId: 'material-2', sourceId: 'different' },
), true, '同じtask IDは完全一致として優先する');

assert.deepEqual(parsePersistedTimerTarget({ owner: 'alice', target }, 'alice'), target);
assert.equal(parsePersistedTimerTarget({ owner: 'bob', target }, 'alice'), null, '別ownerの保存タイマーを無視する');
assert.equal(parsePersistedTimerTarget({ owner: 'alice', target: { ...target, range: { start: 20, end: 11 } } }, 'alice'), null, '不正範囲を拒否する');

console.log('timer target identity tests passed');
