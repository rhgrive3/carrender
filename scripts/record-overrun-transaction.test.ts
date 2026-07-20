import assert from 'node:assert/strict';
import { addDays, today } from '../src/lib/date';
import { applyRecordSessionTransaction } from '../src/lib/recordSessionTransaction';
import { appReducer, emptyState } from '../src/state/AppContext';
import type { AppState, Material, StudyTask } from '../src/types';

const ref = today();
const now = new Date().toISOString();
const material: Material = { id: 'm', subjectId: 's', name: '問題集', unit: '問題', totalAmount: 10, totalUnits: 10, doneAmount: 0, completedRanges: [], startDate: ref, targetDate: addDays(ref, 10), priority: 3, difficulty: 3, minutesPerUnit: 10, unitStep: 1, splittable: true, preferredCadence: { type: 'auto' }, dailyTarget: null, weeklyTarget: null, deadlinePolicy: 'normal', examRelevance: 3, reviewEnabled: false, reviewIntervals: [1, 3, 7], paused: false, round: 1, archived: false, createdAt: now };
const task: StudyTask = { id: 't', subjectId: 's', materialId: 'm', title: '問題集', rangeLabel: '1', rangeStart: 1, rangeEnd: 1, materialRange: { start: 1, end: 1 }, amount: 1, estimatedMinutes: 10, priority: 50, dueDate: null, type: 'new', status: 'planned', scheduledDate: ref, scheduledStart: '09:00', scheduledEnd: '09:10', generatedBy: 'auto', reviewStage: null, createdAt: now, updatedAt: now, completedAt: null, sourceType: 'material', sourceId: 'm', placementStatus: 'scheduled', placementLock: 'none' };
const base = emptyState();
const state: AppState = { ...base, onboarded: true, subjects: [{ id: 's', name: '数学', color: '#4f7cff', importance: 3, weakness: 3 }], materials: [material], tasks: [task], availability: ([0,1,2,3,4,5,6] as const).map((weekday) => ({ weekday, minutes: 600, windows: [{ start: '00:00', end: '23:59' }] })) };

const recorded = appReducer(state, { type: 'RECORD_SESSION', input: { taskId: 't', subjectId: 's', materialId: 'm', minutes: 10, amountDone: 1, focus: 3, memo: '', source: 'manual', rangeLabel: '1', completedTask: true, date: ref, startTime: '00:00' } });
const session = recorded.sessions.at(-1)!;
assert.equal(recorded.tasks.find((entry) => entry.id === task.id)?.status, 'done', '最初の完了記録で今日のタスクをチェック済みにする');

const edited = applyRecordSessionTransaction(recorded, { type: 'UPDATE_SESSION', sessionId: session.id, input: { taskId: null, subjectId: 's', materialId: 'm', minutes: 10, amountDone: 2, focus: 3, memo: '', source: 'manual', rangeLabel: '問題集', completedTask: false, date: ref, startTime: '00:00' } }, ref);
const next = edited.sessions.find((entry) => entry.id === session.id);
const completedTask = edited.tasks.find((entry) => entry.id === task.id);
assert.equal(next?.amountDone, 2, '予定量を超えた実績を教材進捗へ反映する');
assert.equal(next?.taskId, task.id, '内部で一時的に参照を外しても保存後は完了タスクへ結び直す');
assert.equal(next?.completedTask, true, '記録の完了フラグを維持する');
assert.equal(completedTask?.status, 'done', '再計算後も今日のチェック済みタスクを消さない');
assert.equal(completedTask?.scheduledDate, ref, '今日の達成率へ含める元の予定日を維持する');
assert.equal(edited.materials[0].doneAmount, 2, '教材進捗は増量後の2問になる');

const replanned = appReducer(edited, { type: 'RESCHEDULE', reason: '回帰確認' });
assert.equal(replanned.tasks.find((entry) => entry.id === task.id)?.status, 'done', '追加の再計算をしても完了履歴を保持する');

const removed = appReducer(replanned, { type: 'DELETE_SESSION', sessionId: session.id });
assert.notEqual(removed.tasks.find((entry) => entry.id === task.id)?.status, 'done', '記録削除時は元タスクを完了前へ正しく戻す');
assert.equal(removed.materials[0].doneAmount, 0, '記録削除時は増量した教材進捗も戻す');

console.log('✅ completed record overrun keeps today completion history');
