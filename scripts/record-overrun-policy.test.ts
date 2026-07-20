import assert from 'node:assert/strict';
import { recordTaskCompletionAmount, shouldDetachEditedTaskReference } from '../src/lib/recordEditCapacity';
import type { StudySession, StudyTask } from '../src/types';

const now = new Date().toISOString();
const task = {
  id: 'task', subjectId: 'subject', materialId: 'material', title: '問題集', rangeLabel: '1', rangeStart: 1, rangeEnd: 1,
  materialRange: { start: 1, end: 1 }, amount: 1, estimatedMinutes: 10, priority: 50, dueDate: null, type: 'new', status: 'done',
  scheduledDate: '2026-07-20', scheduledStart: '09:00', scheduledEnd: '09:10', generatedBy: 'auto', reviewStage: null,
  createdAt: now, updatedAt: now, completedAt: now, sourceType: 'material', sourceId: 'material', placementStatus: 'scheduled', placementLock: 'none',
} satisfies StudyTask;
const session = {
  id: 'session', taskId: task.id, subjectId: 'subject', materialId: 'material', date: '2026-07-20', startedAt: now,
  minutes: 10, amountDone: 1, rangeLabel: '1', focus: 3, memo: '', source: 'manual', progressRangesAdded: [{ start: 1, end: 1 }],
  taskSnapshotBefore: task, completedTask: true, updatedAt: now,
} satisfies StudySession;

assert.equal(recordTaskCompletionAmount(task, session), 1);
assert.equal(shouldDetachEditedTaskReference(session, true, 2, 1), true);
assert.equal(shouldDetachEditedTaskReference(session, true, 1, 1), false);

console.log('✅ record overrun policy passed');
