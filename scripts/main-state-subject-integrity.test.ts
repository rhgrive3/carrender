import assert from 'node:assert/strict';
import { mergeMainStates, snapshotMainStateEntityHashes } from '../src/lib/mainStateMerge';
import { emptyState } from '../src/state/AppContext';
import type { AppState, Material, StudySession } from '../src/types';

function material(subjectId = 'subject-a'): Material {
  return {
    id: 'material-a', subjectId, name: '教材A', unit: '問題', totalAmount: 10, totalUnits: 10, doneAmount: 0,
    completedRanges: [], startDate: '2026-07-14', targetDate: '2026-08-14', priority: 3, difficulty: 3,
    minutesPerUnit: 30, unitStep: 1, splittable: true, preferredCadence: { type: 'auto' }, dailyTarget: null,
    weeklyTarget: null, deadlinePolicy: 'normal', examRelevance: 3, reviewEnabled: false, reviewIntervals: [1, 3, 7],
    paused: false, round: 1, archived: false, createdAt: '2026-07-14T00:00:00.000Z',
  };
}

function session(subjectId = 'subject-a', memo = 'base'): StudySession {
  return {
    id: 'session-a', taskId: null, subjectId, materialId: 'material-a', date: '2026-07-14',
    startedAt: '2026-07-14T09:00:00.000Z', minutes: 30, amountDone: 1, rangeLabel: '1', focus: 4,
    memo, source: 'manual', updatedAt: '2026-07-14T10:00:00.000Z',
  };
}

function state(): AppState {
  return {
    ...emptyState(),
    onboarded: true,
    subjects: [
      { id: 'subject-a', name: '数学', color: '#3366ff', importance: 3, weakness: 3 },
      { id: 'subject-b', name: '物理', color: '#6633ff', importance: 3, weakness: 3 },
    ],
    materials: [material()],
    sessions: [session()],
  };
}

{
  const base = state();
  const local = { ...base, materials: [material('subject-b')] };
  const remote = { ...base, sessions: [session('subject-a', '別端末で更新')] };
  const result = mergeMainStates(snapshotMainStateEntityHashes(base), local, remote);
  assert.equal(result.merged, null, '教材の科目移動と記録更新を統合して科目不一致を作らない');
  assert.ok(result.conflicts.some((conflict) => conflict.section === 'sessions' && conflict.key === 'session-a'));
}

{
  const base = state();
  const local = { ...base, materials: [material('subject-b')], sessions: [session('subject-b')] };
  const remote = base;
  const result = mergeMainStates(snapshotMainStateEntityHashes(base), local, remote);
  assert.ok(result.merged, '教材と記録を同じ科目へ移した整合した変更は統合できる');
  assert.equal(result.merged?.sessions[0]?.subjectId, 'subject-b');
}

console.log('✅ main state subject integrity regressions passed');
