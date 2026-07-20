import assert from 'node:assert/strict';
import { addDays, today } from '../src/lib/date';
import { applyRecordSessionTransaction } from '../src/lib/recordSessionTransaction';
import { appReducer, emptyState } from '../src/state/AppContext';
import type { AppState, Material, StudyTask } from '../src/types';

const ref = today();
const now = new Date().toISOString();
const subject = { id: 'subject', name: '数学', color: '#4f7cff', importance: 3 as const, weakness: 3 as const };
const material: Material = {
  id: 'material', subjectId: subject.id, name: '数学特講IIIC', unit: '問題', totalAmount: 20, totalUnits: 20,
  doneAmount: 9, completedRanges: [{ start: 1, end: 9 }], startDate: ref, targetDate: addDays(ref, 30),
  priority: 3, difficulty: 3, minutesPerUnit: 10, unitStep: 1, splittable: true,
  preferredCadence: { type: 'auto' }, dailyTarget: null, weeklyTarget: null, deadlinePolicy: 'normal',
  examRelevance: 3, reviewEnabled: false, reviewIntervals: [1, 3, 7], paused: false, round: 1,
  archived: false, createdAt: now,
};

function makeTask(amount: number): StudyTask {
  const end = 9 + amount;
  return {
    id: `task-${amount}`, subjectId: subject.id, materialId: material.id, title: material.name,
    rangeLabel: amount === 1 ? '10' : `10〜${end}`, rangeStart: 10, rangeEnd: end,
    materialRange: { start: 10, end }, amount, estimatedMinutes: amount * 10, priority: 50,
    dueDate: material.targetDate, type: 'new', status: 'planned', scheduledDate: ref,
    scheduledStart: '12:00', scheduledEnd: amount === 1 ? '12:10' : '12:30', generatedBy: 'auto',
    reviewStage: null, createdAt: now, updatedAt: now, completedAt: null,
    sourceType: 'material', sourceId: material.id, placementStatus: 'scheduled', placementLock: 'none',
  };
}

function makeState(task: StudyTask): AppState {
  const base = emptyState();
  return {
    ...base,
    onboarded: true,
    subjects: [subject],
    materials: [material],
    tasks: [task],
    availability: ([0, 1, 2, 3, 4, 5, 6] as const).map((weekday) => ({
      weekday,
      minutes: 600,
      windows: [{ start: '00:00', end: '23:59' }],
    })),
    settings: { ...base.settings, maxDailyMinutes: 600, sessionMinMinutes: 5, sessionMaxMinutes: 120, taskGenerationHorizonDays: 7 },
  };
}

function completeTask(state: AppState, task: StudyTask) {
  return appReducer(state, {
    type: 'RECORD_SESSION',
    input: {
      taskId: task.id, subjectId: subject.id, materialId: material.id, minutes: 68,
      amountDone: task.amount, focus: 5, memo: '', source: 'timer', rangeLabel: material.name,
      completedTask: true, date: ref, startTime: '00:00',
    },
  });
}

const oneTask = makeTask(1);
const oneCompleted = completeTask(makeState(oneTask), oneTask);
const oneSession = oneCompleted.sessions.at(-1)!;
const overflowEdited = applyRecordSessionTransaction(oneCompleted, {
  type: 'UPDATE_SESSION',
  sessionId: oneSession.id,
  input: {
    taskId: null,
    subjectId: oneSession.subjectId,
    materialId: oneSession.materialId,
    minutes: oneSession.minutes,
    amountDone: 2,
    focus: oneSession.focus,
    memo: oneSession.memo,
    source: oneSession.source,
    rangeLabel: material.name,
    completedTask: false,
    date: oneSession.date,
    startTime: '00:00',
  },
}, ref);
const overflowSession = overflowEdited.sessions.find((entry) => entry.id === oneSession.id);
assert.equal(overflowSession?.amountDone, 2, '1問予定の完了ログを2問へ編集した値を保存する');
assert.equal(overflowSession?.taskId, null, '予定量を超えた編集は1問タスク参照を外す');
assert.deepEqual(overflowSession?.progressRangesAdded, [{ start: 10, end: 11 }], '実績2問を教材進捗へ反映する');
assert.equal(overflowEdited.materials[0].doneAmount, 11, '教材進捗を既存9問から11問へ更新する');

const threeTask = makeTask(3);
const threeCompleted = completeTask(makeState(threeTask), threeTask);
const threeSession = threeCompleted.sessions.at(-1)!;
const partialEdited = appReducer(threeCompleted, {
  type: 'UPDATE_SESSION',
  sessionId: threeSession.id,
  input: {
    taskId: threeSession.taskId,
    subjectId: threeSession.subjectId,
    materialId: threeSession.materialId,
    minutes: threeSession.minutes,
    amountDone: 2,
    focus: threeSession.focus,
    memo: threeSession.memo,
    source: threeSession.source,
    rangeLabel: threeSession.rangeLabel,
    completedTask: false,
    date: threeSession.date,
    startTime: '00:00',
  },
});
const partialSession = partialEdited.sessions.find((entry) => entry.id === threeSession.id);
assert.equal(partialSession?.amountDone, 2, '3問予定の完了ログを2問へ減らした値を保存する');
assert.equal(partialSession?.completedTask, false, '予定量未満へ減らしたログは途中記録にする');
assert.deepEqual(partialSession?.progressRangesAdded, [{ start: 10, end: 11 }], '減らした実績2問だけを教材進捗へ残す');

console.log('✅ completed record amount edit behavior passed');
