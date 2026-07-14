import assert from 'node:assert/strict';
import { mergeMainStates, snapshotMainStateEntityHashes } from '../src/lib/mainStateMerge';
import { emptyState } from '../src/state/AppContext';
import type { AppState, Material, StudySession } from '../src/types';

function material(id: string, name: string): Material {
  return {
    id, subjectId: 'subject', name, unit: '問題', totalAmount: 10, totalUnits: 10, doneAmount: 0,
    completedRanges: [], startDate: '2026-07-14', targetDate: '2026-08-14', priority: 3, difficulty: 3,
    minutesPerUnit: 30, unitStep: 1, splittable: true, preferredCadence: { type: 'auto' }, dailyTarget: null,
    weeklyTarget: null, deadlinePolicy: 'normal', examRelevance: 3, reviewEnabled: false, reviewIntervals: [1, 3, 7],
    paused: false, round: 1, archived: false, createdAt: '2026-07-14T00:00:00.000Z',
  };
}

function session(id: string, memo: string): StudySession {
  return {
    id, taskId: null, subjectId: 'subject', materialId: 'material-a', date: '2026-07-14',
    startedAt: '2026-07-14T09:00:00.000Z', minutes: 30, amountDone: 1, rangeLabel: '1', focus: 4,
    memo, source: 'manual', updatedAt: '2026-07-14T10:00:00.000Z',
  };
}

function state(): AppState {
  return {
    ...emptyState(),
    onboarded: true,
    subjects: [{ id: 'subject', name: '数学', color: '#3366ff', importance: 3, weakness: 3 }],
    materials: [material('material-a', '教材A'), material('material-b', '教材B')],
    sessions: [session('session-a', 'base')],
  };
}

function withMonthlySummary(input: AppState, studyMinutes: number, sessionCount: number): AppState {
  return {
    ...input,
    settings: {
      ...input.settings,
      historyData: {
        planRevisions: input.settings.historyData?.planRevisions ?? [],
        monthlySummaries: [{
          month: '2025-01',
          studyMinutes,
          sessionCount,
          completedTaskCount: 0,
          plannedMinutes: 0,
          missedMinutes: 0,
          subjectMinutes: [{ subjectId: 'subject', minutes: studyMinutes }],
        }],
      },
    },
  };
}

{
  const base = state();
  const local = { ...base, materials: base.materials.map((item) => item.id === 'material-a' ? { ...item, name: '端末で変更' } : item) };
  const remote = { ...base, sessions: [...base.sessions, session('session-b', 'クラウドで追加')] };
  const result = mergeMainStates(snapshotMainStateEntityHashes(base), local, remote);
  assert.ok(result.merged, '異なるID・sectionの変更は自動統合できる');
  assert.equal(result.merged?.materials.find((item) => item.id === 'material-a')?.name, '端末で変更');
  assert.ok(result.merged?.sessions.some((item) => item.id === 'session-b'));
  assert.equal(result.conflicts.length, 0);
}

{
  const base = state();
  const local = { ...base, materials: base.materials.filter((item) => item.id !== 'material-b') };
  const remote = { ...base, sessions: [...base.sessions, session('session-b', 'remote')] };
  const result = mergeMainStates(snapshotMainStateEntityHashes(base), local, remote);
  assert.ok(result.merged);
  assert.ok(!result.merged?.materials.some((item) => item.id === 'material-b'), '片側だけの削除はbase hashをtombstoneとして伝播する');
  assert.ok(result.deletedKeys.includes('materials:material-b'));
}

{
  const base = state();
  const local = { ...base, materials: base.materials.filter((item) => item.id !== 'material-a') };
  const remote = { ...base, materials: base.materials.map((item) => item.id === 'material-a' ? { ...item, name: 'クラウド編集' } : item) };
  const result = mergeMainStates(snapshotMainStateEntityHashes(base), local, remote);
  assert.equal(result.merged, null, '削除と同一ID編集は勝手に決めない');
  assert.equal(result.conflicts[0]?.reason, 'deleteVsEdit');
}

{
  const base = state();
  const local = { ...base, materials: base.materials.map((item) => item.id === 'material-a' ? { ...item, name: '端末編集' } : item) };
  const remote = { ...base, materials: base.materials.map((item) => item.id === 'material-a' ? { ...item, name: 'クラウド編集' } : item) };
  const result = mergeMainStates(snapshotMainStateEntityHashes(base), local, remote);
  assert.equal(result.merged, null, '同一IDの両側編集は明示競合に残す');
  assert.equal(result.conflicts[0]?.reason, 'bothChanged');
}

{
  const base = state();
  const local = { ...base, sessions: [...base.sessions, session('local-new', 'local')] };
  const remote = { ...base, sessions: [...base.sessions, session('remote-new', 'remote')] };
  const result = mergeMainStates(snapshotMainStateEntityHashes(base), local, remote);
  assert.ok(result.merged?.sessions.some((item) => item.id === 'local-new'));
  assert.ok(result.merged?.sessions.some((item) => item.id === 'remote-new'));
}

{
  const base = withMonthlySummary(state(), 90, 1);
  const local = withMonthlySummary(base, 120, 2);
  const remote = { ...base, sessions: [...base.sessions, session('remote-new', 'remote')] };
  const result = mergeMainStates(snapshotMainStateEntityHashes(base), local, remote);
  assert.equal(result.merged?.settings.historyData?.monthlySummaries[0]?.studyMinutes, 120, '片側だけの月次集計更新は保持する');
}

{
  const base = withMonthlySummary(state(), 90, 1);
  const local = withMonthlySummary(base, 120, 2);
  const remote = withMonthlySummary(base, 150, 3);
  const result = mergeMainStates(snapshotMainStateEntityHashes(base), local, remote);
  assert.equal(result.merged, null, '同じ月の両側更新をmaxで潰さず明示競合に残す');
  assert.deepEqual(result.conflicts[0], { section: 'monthlySummaries', key: '2025-01', reason: 'bothChanged' });
}

{
  const base = { ...state(), lastPlannedDate: '2026-07-14', lastPlanReason: 'base' };
  const local = { ...base, materials: base.materials.map((item) => item.id === 'material-a' ? { ...item, name: '端末編集' } : item) };
  const remote = { ...base, lastPlannedDate: '2026-07-15', lastPlanReason: 'クラウドで予定再生成' };
  const result = mergeMainStates(snapshotMainStateEntityHashes(base), local, remote);
  assert.equal(result.merged?.lastPlannedDate, '2026-07-15', 'クラウドだけで更新された予定メタデータを保持する');
  assert.equal(result.merged?.lastPlanReason, 'クラウドで予定再生成');
  assert.ok(result.appliedRemoteKeys.includes('scheduleState:value'));
}

{
  const base = { ...state(), lastPlannedDate: '2026-07-14', lastPlanReason: 'base' };
  const local = { ...base, lastPlannedDate: '2026-07-15', lastPlanReason: '端末で予定再生成' };
  const remote = { ...base, lastPlannedDate: '2026-07-16', lastPlanReason: 'クラウドで予定再生成' };
  const result = mergeMainStates(snapshotMainStateEntityHashes(base), local, remote);
  assert.equal(result.merged, null, '両端末で予定を再生成した場合は診断状態を勝手に選ばない');
  assert.deepEqual(result.conflicts[0], { section: 'scheduleState', key: 'value', reason: 'bothChanged' });
}

{
  const base = state();
  const staleRevision = {
    id: 'plan-revision:stale:2024-01-01T00:00:00.000Z', generationId: 'stale', createdAt: '2024-01-01T00:00:00.000Z',
    reason: '古い計画', fromDate: '2024-01-01', placements: [], changes: [], materialChanges: [],
  };
  const freshRevision = {
    id: 'plan-revision:fresh:2026-07-14T00:00:00.000Z', generationId: 'fresh', createdAt: '2026-07-14T00:00:00.000Z',
    reason: '新しい計画', fromDate: '2026-07-14', placements: [], changes: [], materialChanges: [],
  };
  const local = {
    ...base,
    settings: { ...base.settings, historyData: { planRevisions: [freshRevision], monthlySummaries: [] } },
  };
  const remote = {
    ...base,
    sessions: [...base.sessions, session('remote-new', 'remote')],
    settings: { ...base.settings, historyData: { planRevisions: [staleRevision, freshRevision], monthlySummaries: [] } },
  };
  const result = mergeMainStates(snapshotMainStateEntityHashes(base), local, remote, new Date('2026-07-15T00:00:00.000Z'));
  assert.deepEqual(
    result.merged?.settings.historyData?.planRevisions.map((revision) => revision.id),
    [freshRevision.id],
    '古い端末との同期でも1年超の計画履歴を復活させない',
  );
}

{
  const base = state();
  const local = {
    ...base,
    materials: base.materials.filter((item) => item.id !== 'material-a'),
    sessions: base.sessions.filter((item) => item.materialId !== 'material-a'),
  };
  const remote = { ...base, sessions: [...base.sessions, session('remote-new', '削除と同時に追加')] };
  const result = mergeMainStates(snapshotMainStateEntityHashes(base), local, remote);
  assert.equal(result.merged, null, '教材削除と同時に別端末で紐づく記録が追加された場合は参照切れを作らない');
  assert.ok(result.conflicts.some((conflict) => conflict.section === 'materials' && conflict.key === 'material-a'));
}

{
  const base = state();
  const local = {
    ...base,
    subjects: [],
    materials: [],
    sessions: [],
  };
  const remote = { ...base, materials: [...base.materials, { ...material('material-c', '追加教材'), subjectId: 'subject' }] };
  const result = mergeMainStates(snapshotMainStateEntityHashes(base), local, remote);
  assert.equal(result.merged, null, '科目削除と同時に別端末で教材が追加された場合は参照切れを作らない');
  assert.ok(result.conflicts.some((conflict) => conflict.section === 'subjects' && conflict.key === 'subject'));
}

console.log('✅ main state entity merge regressions passed');
