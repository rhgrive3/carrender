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
const base = {
  ...emptyState(), onboarded: true,
  subjects: [{ id: 'subject', name: '英語', color: '#4f7cff', importance: 3, weakness: 3 }],
  sessions: [session],
} satisfies AppState;

const plannedState = { ...base, tasks: [snapshot] } satisfies AppState;
const repaired = reconcileCompletedTaskHistory(plannedState);
const restored = repaired.state.tasks.find((task) => task.id === snapshot.id);
assert.equal(repaired.repairs.length, 1);
assert.equal(restored?.status, 'done');
assert.equal(restored?.scheduledDate, date);
assert.equal(restored?.rangeLabel, snapshot.rangeLabel);
assert.strictEqual(reconcileCompletedTaskHistory(repaired.state).state, repaired.state);

const explicitlyDeletedState = { ...base, tasks: [] } satisfies AppState;
const preservedDeletion = reconcileCompletedTaskHistory(explicitlyDeletedState);
assert.equal(preservedDeletion.repairs.length, 0, '欠損タスクを推測で復元しない');
assert.strictEqual(preservedDeletion.state, explicitlyDeletedState, '明示削除済み状態を変更しない');

const latestDate = '2026-07-21';
const latestNow = '2026-07-21T10:30:00.000Z';
const latestSnapshot = {
  ...snapshot,
  title: '英作文（再設定後）',
  rangeLabel: '第2問',
  scheduledDate: latestDate,
  scheduledStart: '10:00',
  scheduledEnd: '10:30',
  updatedAt: latestNow,
} satisfies StudyTask;
const latestSession = {
  ...session,
  id: 'done-session-latest',
  date: latestDate,
  startedAt: latestNow,
  rangeLabel: latestSnapshot.rangeLabel,
  taskSnapshotBefore: latestSnapshot,
  updatedAt: latestNow,
} satisfies StudySession;
const repeatedCompletionState = {
  ...base,
  tasks: [{ ...latestSnapshot, status: 'planned' }],
  sessions: [latestSession, session],
} satisfies AppState;
const repairedRepeatedCompletion = reconcileCompletedTaskHistory(repeatedCompletionState);
const latestRestored = repairedRepeatedCompletion.state.tasks[0];
assert.equal(repairedRepeatedCompletion.repairs.length, 1, '同一タスクは一度だけ修復する');
assert.equal(repairedRepeatedCompletion.repairs[0]?.sessionId, latestSession.id, '最新の完了記録を採用する');
assert.equal(latestRestored.status, 'done');
assert.equal(latestRestored.title, latestSnapshot.title, '古いタイトルへ巻き戻さない');
assert.equal(latestRestored.rangeLabel, latestSnapshot.rangeLabel, '古い範囲へ巻き戻さない');
assert.equal(latestRestored.scheduledDate, latestDate, '古い予定日へ巻き戻さない');

console.log('✅ completed task history repair, deletion preservation, and latest completion precedence passed');
