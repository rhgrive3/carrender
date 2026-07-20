import assert from 'node:assert/strict';
import { reconcileCompletedTaskHistory } from '../src/lib/materialProgressIntegrity';
import { emptyState } from '../src/state/AppContext';
import type { AppState, StudySession, StudyTask } from '../src/types';

const date = '2026-07-20';
const now = '2026-07-20T09:30:00.000Z';
const snapshot = {
  id: 'done-task', subjectId: 'subject', materialId: null, title: '英作文', rangeLabel: '第1問',
  rangeStart: null, rangeEnd: null, amount: 1, estimatedMinutes: 30, priority: 50, dueDate: null,
  type: 'new', status: 'planned', scheduledDate: date, scheduledStart: '09:00', scheduledEnd: '09:30',
  generatedBy: 'manual', reviewStage: null, createdAt: now, updatedAt: now, completedAt: null,
  sourceType: 'manual', sourceId: 'done-task', placementStatus: 'scheduled', placementLock: 'time',
} satisfies StudyTask;
const session = {
  id: 'done-session', taskId: snapshot.id, subjectId: 'subject', materialId: null, date,
  startedAt: now, minutes: 30, amountDone: 1, rangeLabel: snapshot.rangeLabel, focus: 4,
  memo: '', source: 'manual', taskSnapshotBefore: snapshot, completedTask: true, updatedAt: now,
} satisfies StudySession;
const state = {
  ...emptyState(), onboarded: true,
  subjects: [{ id: 'subject', name: '英語', color: '#4f7cff', importance: 3, weakness: 3 }],
  tasks: [], sessions: [session],
} satisfies AppState;

const repaired = reconcileCompletedTaskHistory(state);
const restored = repaired.state.tasks.find((task) => task.id === snapshot.id);
assert.equal(repaired.repairs.length, 1);
assert.equal(restored?.status, 'done');
assert.equal(restored?.scheduledDate, date);
assert.equal(restored?.rangeLabel, snapshot.rangeLabel);
assert.strictEqual(reconcileCompletedTaskHistory(repaired.state).state, repaired.state);
console.log('✅ missing completed task history repair passed');
