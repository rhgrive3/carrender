import assert from 'node:assert/strict';
import { mergeMainStates, snapshotMainStateEntityHashes } from '../src/lib/mainStateMerge';
import { emptyState } from '../src/state/AppContext';
import type { AppState, Material, StudyTask } from '../src/types';

const subject = { id: 'subject', name: '数学', color: '#3366ff', importance: 3 as const, weakness: 3 as const };
const material: Material = {
  id: 'material-a', subjectId: subject.id, name: '教材A', unit: '問題', totalAmount: 10, totalUnits: 10,
  doneAmount: 0, completedRanges: [], startDate: '2026-07-15', targetDate: '2026-08-15', priority: 3,
  difficulty: 3, minutesPerUnit: 30, unitStep: 1, splittable: true, preferredCadence: { type: 'auto' },
  dailyTarget: null, weeklyTarget: null, deadlinePolicy: 'normal', examRelevance: 3, reviewEnabled: false,
  reviewIntervals: [1, 3, 7], paused: false, round: 1, archived: false, createdAt: '2026-07-15T00:00:00.000Z',
};
const task: StudyTask = {
  id: 'manual-task', subjectId: subject.id, materialId: null, title: '手動演習', rangeLabel: '', rangeStart: null,
  rangeEnd: null, amount: 1, estimatedMinutes: 30, priority: 1, dueDate: null, type: 'new', status: 'planned',
  scheduledDate: '2026-07-15', scheduledStart: null, scheduledEnd: null, generatedBy: 'manual', reviewStage: null,
  createdAt: '2026-07-15T00:00:00.000Z', completedAt: null, manualScheduling: {
    placementPolicy: 'flexibleBeforeDeadline', deadline: '2026-08-15',
    progressPolicy: { type: 'countTowardMaterial', materialId: material.id, amount: 1 }, splittable: true,
  },
};

function state(): AppState {
  return { ...emptyState(), onboarded: true, subjects: [subject], materials: [material], tasks: [task] };
}

{
  const base = state();
  const local = { ...base, materials: [] };
  const remote = { ...base, tasks: [{ ...task, memo: '別端末で編集' }] };
  const result = mergeMainStates(snapshotMainStateEntityHashes(base), local, remote);
  assert.equal(result.merged, null, '教材削除と手動タスクの進捗参照更新を自動統合しない');
  assert.ok(result.conflicts.some((conflict) => conflict.section === 'materials' && conflict.key === material.id));
}

{
  const base = state();
  const otherSubject = { id: 'english', name: '英語', color: '#00aa88', importance: 3 as const, weakness: 3 as const };
  const local = { ...base, subjects: [...base.subjects, otherSubject], materials: [{ ...material, subjectId: otherSubject.id }] };
  const remote = { ...base, tasks: [{ ...task, memo: '別端末で編集' }] };
  const result = mergeMainStates(snapshotMainStateEntityHashes(base), local, remote);
  assert.equal(result.merged, null, '進捗加算先教材の科目とタスク科目が食い違う状態を作らない');
  assert.ok(result.conflicts.some((conflict) => conflict.section === 'tasks' && conflict.key === task.id));
}

console.log('✅ manual progress material integrity regressions passed');
