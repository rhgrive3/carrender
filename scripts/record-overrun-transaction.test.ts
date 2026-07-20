import assert from 'node:assert/strict';
import { addDays, today } from '../src/lib/date';
import { applyRecordSessionTransaction } from '../src/lib/recordSessionTransaction';
import { appReducer, emptyState } from '../src/state/AppContext';
import type { AppState, Material, StudyTask } from '../src/types';

const ref = today();
const now = new Date().toISOString();
const material: Material = {
  id: 'm', subjectId: 's', name: '問題集', unit: 'ページ', totalAmount: 10, totalUnits: 10,
  doneAmount: 3, completedRanges: [{ start: 1, end: 3 }], startDate: ref, targetDate: addDays(ref, 10),
  priority: 3, difficulty: 3, minutesPerUnit: 10, unitStep: 1, splittable: true,
  preferredCadence: { type: 'auto' }, dailyTarget: null, weeklyTarget: null, deadlinePolicy: 'normal',
  examRelevance: 3, reviewEnabled: false, reviewIntervals: [1, 3, 7], paused: false, round: 1,
  archived: false, createdAt: now,
};
const task: StudyTask = {
  id: 't', subjectId: 's', materialId: 'm', title: '問題集', rangeLabel: '4ページ',
  rangeStart: 4, rangeEnd: 4, materialRange: { start: 4, end: 4 }, amount: 1, estimatedMinutes: 10,
  priority: 50, dueDate: null, type: 'new', status: 'planned', scheduledDate: ref,
  scheduledStart: '09:00', scheduledEnd: '09:10', generatedBy: 'auto', reviewStage: null,
  createdAt: now, updatedAt: now, completedAt: null, sourceType: 'material', sourceId: 'm',
  placementStatus: 'scheduled', placementLock: 'none',
};
const base = emptyState();
const state: AppState = {
  ...base,
  onboarded: true,
  subjects: [{ id: 's', name: '数学', color: '#4f7cff', importance: 3, weakness: 3 }],
  materials: [material],
  tasks: [task],
  availability: ([0, 1, 2, 3, 4, 5, 6] as const)
    .map((weekday) => ({ weekday, minutes: 600, windows: [{ start: '00:00', end: '23:59' }] })),
};

const timerRecorded = applyRecordSessionTransaction(state, {
  type: 'RECORD_SESSION',
  input: {
    taskId: task.id,
    taskLocator: { sourceId: task.sourceId, range: task.materialRange, type: task.type },
    subjectId: 's', materialId: 'm', minutes: 20, amountDone: 2, focus: 3, memo: '', source: 'timer',
    rangeLabel: task.rangeLabel, completedTask: true, date: ref, startTime: '09:00',
  },
}, ref);
const timerSession = timerRecorded.sessions.at(-1)!;
assert.equal(timerSession.amountDone, 2, 'タイマー終了時に予定1ページを超えた2ページを保存する');
assert.equal(timerSession.taskId, task.id, '超過しても完了タスクとの参照を維持する');
assert.equal(timerSession.completedTask, true, 'タイマーの完了フラグを維持する');
assert.deepEqual(timerSession.progressRangesAdded, [{ start: 4, end: 5 }], '予定範囲の直後へ超過1ページを割り当てる');
assert.equal(timerRecorded.materials[0].doneAmount, 5, '教材進捗へ予定分と超過分の両方を反映する');
assert.equal(timerRecorded.tasks.find((entry) => entry.id === task.id)?.status, 'done', '再計算後も今日の完了タスクを残す');
assert.equal(timerRecorded.tasks.find((entry) => entry.id === task.id)?.scheduledDate, ref, '今日の達成率へ含める予定日を維持する');

const edited = applyRecordSessionTransaction(timerRecorded, {
  type: 'UPDATE_SESSION',
  sessionId: timerSession.id,
  input: {
    taskId: task.id,
    subjectId: 's', materialId: 'm', minutes: 30, amountDone: 3, focus: 4, memo: '', source: 'timer',
    rangeLabel: task.rangeLabel, completedTask: true, date: ref, startTime: '09:00',
  },
}, ref);
const editedSession = edited.sessions.find((entry) => entry.id === timerSession.id)!;
assert.equal(editedSession.amountDone, 3, '学習ログから2ページを3ページへ増やした値を保存する');
assert.deepEqual(editedSession.progressRangesAdded, [{ start: 4, end: 6 }], 'ログ編集後の進捗範囲を3ページ分へ更新する');
assert.equal(edited.materials[0].doneAmount, 6, 'ログ編集後の教材進捗を6ページまで更新する');
assert.equal(edited.tasks.find((entry) => entry.id === task.id)?.status, 'done', 'ログ編集に伴う再計算でもチェック済みを消さない');

const replanned = appReducer(edited, { type: 'RESCHEDULE', reason: '回帰確認' });
assert.equal(replanned.tasks.find((entry) => entry.id === task.id)?.status, 'done', '追加の全体再計算後も完了履歴を保持する');

const removed = appReducer(replanned, { type: 'DELETE_SESSION', sessionId: timerSession.id });
assert.notEqual(removed.tasks.find((entry) => entry.id === task.id)?.status, 'done', '記録削除時は元タスクを完了前へ戻す');
assert.equal(removed.materials[0].doneAmount, 3, '記録削除時は元からあった3ページだけを残す');

console.log('✅ timer and edited record overruns preserve today completion history');
