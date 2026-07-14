import assert from 'node:assert/strict';
import { mergeMainStates, snapshotMainStateEntityHashes } from '../src/lib/mainStateMerge';
import { emptyState } from '../src/state/AppContext';
import type { AppState, StudySession, StudyTask } from '../src/types';

const subject = { id: 'subject', name: '数学', color: '#3366ff', importance: 3 as const, weakness: 3 as const };
const task: StudyTask = {
  id: 'task-a', subjectId: subject.id, materialId: null, title: '演習', rangeLabel: '', rangeStart: null,
  rangeEnd: null, amount: 1, estimatedMinutes: 30, priority: 1, dueDate: null, type: 'new', status: 'done',
  scheduledDate: '2026-07-15', scheduledStart: null, scheduledEnd: null, generatedBy: 'manual', reviewStage: null,
  createdAt: '2026-07-15T00:00:00.000Z', completedAt: '2026-07-15T01:00:00.000Z',
};
const session: StudySession = {
  id: 'session-a', taskId: task.id, subjectId: subject.id, materialId: null, date: '2026-07-15',
  startedAt: '2026-07-15T00:30:00.000Z', minutes: 30, amountDone: 1, rangeLabel: '', focus: 4, memo: '', source: 'timer',
};

function state(): AppState {
  return { ...emptyState(), onboarded: true, subjects: [subject], tasks: [task], sessions: [session] };
}

{
  const base = state();
  const local = { ...base, tasks: [] };
  const remote = { ...base, sessions: [{ ...session, memo: '別端末で記録を編集' }] };
  const result = mergeMainStates(snapshotMainStateEntityHashes(base), local, remote);
  assert.equal(result.merged, null, '削除済みタスクを参照する記録を自動統合しない');
  assert.ok(result.conflicts.some((conflict) => conflict.section === 'tasks' && conflict.key === task.id));
}

{
  const base = { ...state(), tasks: [], sessions: [] };
  const local = base;
  const remote = { ...base, sessions: [{ ...session, id: 'orphan-session' }] };
  const result = mergeMainStates(snapshotMainStateEntityHashes(base), local, remote);
  assert.equal(result.merged, null, '参照先タスクが存在しない新規記録を受け入れない');
  assert.ok(result.conflicts.some((conflict) => conflict.section === 'sessions' && conflict.key === 'orphan-session'));
}

console.log('✅ session task integrity regressions passed');
