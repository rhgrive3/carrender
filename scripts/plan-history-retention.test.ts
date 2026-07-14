import assert from 'node:assert/strict';
import { applyOneYearHistoryRetention } from '../src/lib/historyRetention';
import { capturePlanRevision, restorePlanRevisionLayout } from '../src/lib/planHistory';
import { emptyState } from '../src/state/AppContext';
import type { AppState, StudySession, StudyTask } from '../src/types';

function task(id: string, scheduledDate: string, status: StudyTask['status'] = 'planned'): StudyTask {
  return {
    id,
    subjectId: 'subject',
    materialId: 'material',
    title: id,
    rangeLabel: '1〜2',
    rangeStart: 1,
    rangeEnd: 2,
    materialRange: { start: 1, end: 2 },
    amount: 2,
    estimatedMinutes: 60,
    priority: 10,
    dueDate: '2026-12-31',
    type: 'new',
    status,
    scheduledDate,
    scheduledStart: '09:00',
    scheduledEnd: '10:00',
    generatedBy: 'auto',
    reviewStage: null,
    sourceType: 'material',
    sourceId: 'material',
    placementStatus: 'scheduled',
    placementLock: 'none',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: status === 'done' ? '2026-01-02T00:00:00.000Z' : null,
  };
}

function baseState(): AppState {
  const state = emptyState();
  return {
    ...state,
    onboarded: true,
    subjects: [{ id: 'subject', name: '数学', color: '#3366ff', importance: 3, weakness: 3 }],
    materials: [{
      id: 'material', subjectId: 'subject', name: '教材', unit: '問題', totalAmount: 100, totalUnits: 100,
      doneAmount: 0, completedRanges: [], startDate: '2026-01-01', targetDate: '2026-12-31', priority: 3,
      difficulty: 3, minutesPerUnit: 30, unitStep: 1, splittable: true, preferredCadence: { type: 'auto' },
      dailyTarget: null, weeklyTarget: null, deadlinePolicy: 'normal', examRelevance: 3, reviewEnabled: false,
      reviewIntervals: [1, 3, 7], paused: false, round: 1, archived: false, createdAt: '2026-01-01T00:00:00.000Z',
    }],
  };
}

{
  const before = { ...baseState(), tasks: [task('a', '2026-07-14')] };
  const after = { ...before, tasks: [{ ...before.tasks[0], scheduledDate: '2026-07-16', scheduledStart: '13:00', scheduledEnd: '14:00' }] };
  const revision = capturePlanRevision({
    before,
    after,
    generationId: 'generation-1',
    reason: '学習記録の反映',
    fromDate: '2026-07-14',
    createdAt: '2026-07-14T12:00:00.000Z',
  });
  assert.equal(revision.changes.length, 1);
  assert.equal(revision.changes[0].kind, 'moved');

  const current = {
    ...after,
    planRevisions: [revision],
    tasks: [{ ...after.tasks[0], scheduledDate: '2026-07-20', scheduledStart: '15:00', scheduledEnd: '16:00' }],
  };
  const restored = restorePlanRevisionLayout(current, revision.id);
  assert.equal(restored.restoredTaskCount, 1);
  assert.equal(restored.state.tasks[0].scheduledDate, '2026-07-16');
  assert.equal(restored.state.tasks[0].scheduledStart, '13:00');
}

{
  const before = { ...baseState(), tasks: [task('a', '2026-07-14')] };
  const after = { ...before, tasks: [{ ...before.tasks[0], scheduledDate: '2026-07-16' }] };
  const revision = capturePlanRevision({
    before,
    after,
    generationId: 'generation-done',
    reason: '再計算',
    fromDate: '2026-07-14',
    createdAt: '2026-07-14T12:00:00.000Z',
  });
  const doneCurrent = { ...after, planRevisions: [revision], tasks: [task('a', '2026-07-20', 'done')] };
  const restored = restorePlanRevisionLayout(doneCurrent, revision.id);
  assert.equal(restored.restoredTaskCount, 0, '完了済みタスクは過去配置へ戻さない');
  assert.equal(restored.state.tasks[0].scheduledDate, '2026-07-20');
}

{
  const oldSession: StudySession = {
    id: 'old-session', taskId: null, subjectId: 'subject', materialId: 'material', date: '2025-01-01',
    startedAt: '2025-01-01T09:00:00.000Z', minutes: 90, amountDone: 3, rangeLabel: '1〜3', focus: 4,
    memo: '', source: 'manual',
  };
  const recentSession = { ...oldSession, id: 'recent-session', date: '2026-07-01', startedAt: '2026-07-01T09:00:00.000Z' };
  const state = {
    ...baseState(),
    sessions: [oldSession, recentSession],
    tasks: [task('old-done', '2025-01-01', 'done'), task('old-active', '2025-01-01', 'planned')],
    planHistory: [{
      id: 'missed:1', taskId: 'missed', subjectId: 'subject', materialId: 'material', title: '未達',
      scheduledDate: '2025-01-02', estimatedMinutes: 30, amount: 1, type: 'new' as const, outcome: 'missed' as const,
      rangeStart: 1, rangeEnd: 1, materialRange: { start: 1, end: 1 }, capturedAt: '2025-01-03T00:00:00.000Z',
    }],
  };
  const retained = applyOneYearHistoryRetention(state, '2026-07-14');
  assert.deepEqual(retained.sessions.map((session) => session.id), ['recent-session']);
  assert.deepEqual(retained.tasks.map((item) => item.id), ['old-active'], '未完了タスクは1年を超えても保持する');
  assert.equal(retained.planHistory?.length, 0);
  assert.equal(retained.historySummaries?.[0]?.studyMinutes, 90);
  assert.equal(retained.historySummaries?.[0]?.completedTaskCount, 1);
  assert.equal(retained.historySummaries?.[0]?.missedMinutes, 30);

  const secondPass = applyOneYearHistoryRetention(retained, '2026-07-14');
  assert.deepEqual(secondPass.historySummaries, retained.historySummaries, '再適用で月次集計を二重加算しない');
}

console.log('✅ plan history and one-year retention regressions passed');
