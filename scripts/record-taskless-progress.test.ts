import assert from 'node:assert/strict';
import { addDays, today } from '../src/lib/date';
import { applyRecordSessionTransaction } from '../src/lib/recordSessionTransaction';
import { emptyState } from '../src/state/AppContext';
import type { AppState, Material, StudyTask } from '../src/types';

const ref = today();
const now = new Date().toISOString();
const material: Material = {
  id: 'material', subjectId: 'subject', name: '問題集', unit: '問題', totalAmount: 20, totalUnits: 20,
  doneAmount: 9, completedRanges: [{ start: 1, end: 9 }], startDate: ref, targetDate: addDays(ref, 30),
  priority: 3, difficulty: 3, minutesPerUnit: 10, unitStep: 1, splittable: true,
  preferredCadence: { type: 'auto' }, dailyTarget: null, weeklyTarget: null, deadlinePolicy: 'normal',
  examRelevance: 3, reviewEnabled: false, reviewIntervals: [1, 3, 7], paused: false, round: 1,
  archived: false, createdAt: now,
};
const task: StudyTask = {
  id: 'today-task', subjectId: 'subject', materialId: material.id, title: material.name,
  rangeLabel: '10〜20', rangeStart: 10, rangeEnd: 20, materialRange: { start: 10, end: 20 },
  amount: 11, estimatedMinutes: 110, priority: 50, dueDate: material.targetDate, type: 'new',
  status: 'planned', scheduledDate: ref, scheduledStart: '12:00', scheduledEnd: '13:50',
  generatedBy: 'auto', reviewStage: null, createdAt: now, updatedAt: now, completedAt: null,
  sourceType: 'material', sourceId: material.id, placementStatus: 'scheduled', placementLock: 'none',
};
const base = emptyState();
const state: AppState = {
  ...base,
  onboarded: true,
  subjects: [{ id: 'subject', name: '数学', color: '#4f7cff', importance: 3, weakness: 3 }],
  materials: [material],
  tasks: [task],
  availability: ([0, 1, 2, 3, 4, 5, 6] as const).map((weekday) => ({
    weekday,
    minutes: 600,
    windows: [{ start: '00:00', end: '23:59' }],
  })),
  settings: { ...base.settings, maxDailyMinutes: 600, sessionMinMinutes: 5, sessionMaxMinutes: 120, taskGenerationHorizonDays: 7 },
};

const recorded = applyRecordSessionTransaction(state, {
  type: 'RECORD_SESSION',
  input: {
    taskId: null,
    subjectId: 'subject',
    materialId: material.id,
    minutes: 20,
    amountDone: 2,
    focus: 3,
    memo: '',
    source: 'manual',
    rangeLabel: material.name,
    completedTask: false,
    date: ref,
    startTime: '00:00',
  },
}, ref);

assert.equal(recorded.sessions.at(-1)?.amountDone, 2, '入力2は累積11ではなく今回やった2問として保存する');
assert.deepEqual(recorded.sessions.at(-1)?.progressRangesAdded, [{ start: 10, end: 11 }], '今回分を直前の未完了範囲へ割り当てる');
assert.deepEqual(recorded.materials[0].completedRanges, [{ start: 1, end: 11 }], '教材進捗は既存9問へ今回2問だけ加える');
assert.notEqual(recorded.lastScheduleResult?.status, 'invalidInput', '当日の旧タスク範囲との重複で記録を拒否しない');
const completed = recorded.materials[0].completedRanges ?? [];
for (const planned of recorded.tasks.filter((item) => item.status === 'planned' && item.type !== 'review' && item.materialId === material.id)) {
  const range = planned.materialRange ?? (planned.rangeStart !== null && planned.rangeEnd !== null
    ? { start: planned.rangeStart, end: planned.rangeEnd }
    : undefined);
  if (!range) continue;
  assert.equal(
    completed.some((done) => range.start <= done.end && range.end >= done.start),
    false,
    `再計画後の${range.start}〜${range.end}は完了済み範囲と重複しない`,
  );
}

console.log('✅ taskless material progress regressions passed');
