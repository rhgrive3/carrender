import assert from 'node:assert/strict';
import type { AppState, StudySession, StudyTask } from '../src/types';
import { repairOrphanedSessionTaskReferences } from '../src/lib/sessionTaskReferences';

const task = {
  id: 'task-existing',
  subjectId: 'subject',
  materialId: 'material',
  title: '問題集',
  scheduledDate: '2026-07-17',
  estimatedMinutes: 30,
  amount: 3,
  status: 'done',
} as StudyTask;

function session(id: string, taskId: string | null): StudySession {
  return {
    id,
    taskId,
    subjectId: 'subject',
    materialId: 'material',
    date: '2026-07-17',
    startedAt: '2026-07-17T09:00:00.000Z',
    minutes: 30,
    amountDone: 3,
    rangeLabel: '1〜3',
    focus: 4,
    memo: '保持するメモ',
    source: 'timer',
    taskSnapshotBefore: { ...task, id: taskId ?? task.id },
    updatedAt: '2026-07-17T09:30:00.000Z',
  };
}

const valid = {
  tasks: [task],
  sessions: [session('valid', task.id), session('taskless', null)],
} as AppState;
const unchanged = repairOrphanedSessionTaskReferences(valid);
assert.strictEqual(unchanged, valid, '正常な状態では不要なstate差替えを発生させない');
assert.equal(unchanged.sessions[0].taskId, task.id, '存在するtaskId参照を保持する');

const orphan = session('orphan', 'task-deleted');
const broken = { tasks: [task], sessions: [orphan, valid.sessions[0]] } as AppState;
const repaired = repairOrphanedSessionTaskReferences(broken);

assert.notStrictEqual(repaired, broken, '孤立参照があれば修復済みstateを返す');
assert.equal(repaired.sessions[0].taskId, null, '存在しないtaskIdだけをnullへ切り離す');
assert.strictEqual(repaired.sessions[1], broken.sessions[1], '正常な記録は同一参照のまま保持する');
assert.deepEqual(repaired.sessions[0].taskSnapshotBefore, orphan.taskSnapshotBefore, 'タスクの履歴snapshotは失わない');
assert.equal(repaired.sessions[0].memo, orphan.memo, '学習記録の本文を変更しない');
assert.equal(orphan.taskId, 'task-deleted', '入力stateを破壊的に変更しない');
assert.strictEqual(repairOrphanedSessionTaskReferences(repaired), repaired, '修復処理は冪等である');

console.log('✅ orphaned session task reference recovery regressions passed');
