import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addDays, today } from '../src/lib/date';
import { applyRecordSessionTransaction } from '../src/lib/recordSessionTransaction';
import { emptyState } from '../src/state/AppContext';
import type { AppState, Material, StudyTask } from '../src/types';

const source = readFileSync(new URL('../src/components/forms/RecordSheet.tsx', import.meta.url), 'utf8');

assert.match(source, /if \(!open\) \{\s*initializedTargetRef\.current = null;/, '閉じたシートは次回表示前に初期化対象を解除する');
assert.match(source, /const targetKey = session[\s\S]*?`session:\$\{session\.id\}`/, '編集対象セッションごとに再初期化する');
assert.match(source, /setSubjectId\(session\?\.subjectId \?\? preset\?\.subjectId/, '科目を新しい対象から復元する');
assert.match(source, /setMaterialId\(session\?\.materialId \?\? preset\?\.materialId/, '教材を新しい対象から復元する');
assert.match(source, /setMemo\(session\?\.memo \?\? ''\)/, '前回入力したメモを次の記録へ持ち越さない');
assert.match(source, /setFocus\(session\?\.focus \?\? null\)/, '集中度を次の記録へ持ち越さない');
assert.match(source, /preset\.source === 'timer' && !session/, 'タイマー記録だけに保存前の時間調整UIを表示する');
assert.match(source, /id="rec-timer-minutes"[\s\S]*value=\{minutes\}[\s\S]*min=\{1\}[\s\S]*max=\{600\}/, 'タイマー時間を1〜600分の範囲で直接入力できる');
assert.match(source, /setMinutes\(Math\.max\(1, minutes - 5\)\)/, 'タイマー時間を5分単位で減らせる');
assert.match(source, /setMinutes\(Math\.min\(600, minutes \+ 5\)\)/, 'タイマー時間を5分単位で増やせる');
assert.match(source, /minutes !== preset\.minutes[\s\S]*setMinutes\(preset\.minutes\)/, '変更後は元の計測時間へ戻せる');
assert.match(source, /記録時間 \{minutes\}分/, '保存対象の時間を現在値として表示する');
assert.match(source, /計測時間 \{preset\.minutes\}分/, '元の計測時間を比較用に残す');
assert.match(source, /minutes: Math\.min\(600, Math\.max\(1, minutes\)\)/, '保存値も編集可能範囲へ確実に収める');
assert.match(source, /const preservesReference = !session \|\| \(session\.subjectId === subjectId && session\.materialId === selectedMaterialId\);/, '科目または教材を変更した編集を参照変更として判定する');
assert.match(source, /rangeLabel: preservesReference[\s\S]*?: material\?\.name \?\? ''/, '参照変更時は旧教材の表示名を残さず新教材名へ同期する');
assert.match(source, /completedTask: Boolean\(preservesReference/, '参照変更時は旧タスクとの完了関連も切り離す');
assert.match(source, /今回やった\$\{material\.unit\}数/, '進捗入力は累積到達点ではなく今回やった個数として案内する');
assert.doesNotMatch(source, /どこまで進んだ\?/u, '累積到達点に見える旧ラベルを残さない');
assert.match(source, /applyRecordSessionTransaction\(state, action, today\(\)\)/, 'タスクなし教材記録は当日の自動予定も残量から再構築する');

const ref = today();
const now = new Date().toISOString();
const material: Material = {
  id: 'material',
  subjectId: 'subject',
  name: '問題集',
  unit: '問題',
  totalAmount: 20,
  totalUnits: 20,
  doneAmount: 9,
  completedRanges: [{ start: 1, end: 9 }],
  startDate: ref,
  targetDate: addDays(ref, 30),
  priority: 3,
  difficulty: 3,
  minutesPerUnit: 10,
  unitStep: 1,
  splittable: true,
  preferredCadence: { type: 'auto' },
  dailyTarget: null,
  weeklyTarget: null,
  deadlinePolicy: 'normal',
  examRelevance: 3,
  reviewEnabled: false,
  reviewIntervals: [1, 3, 7],
  paused: false,
  round: 1,
  archived: false,
  createdAt: now,
};
const task: StudyTask = {
  id: 'today-task',
  subjectId: 'subject',
  materialId: material.id,
  title: material.name,
  rangeLabel: '10〜20',
  rangeStart: 10,
  rangeEnd: 20,
  materialRange: { start: 10, end: 20 },
  amount: 11,
  estimatedMinutes: 110,
  priority: 50,
  dueDate: material.targetDate,
  type: 'new',
  status: 'planned',
  scheduledDate: ref,
  scheduledStart: '12:00',
  scheduledEnd: '13:50',
  generatedBy: 'auto',
  reviewStage: null,
  createdAt: now,
  updatedAt: now,
  completedAt: null,
  sourceType: 'material',
  sourceId: material.id,
  placementStatus: 'scheduled',
  placementLock: 'none',
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

assert.equal(recorded.sessions.at(-1)?.amountDone, 2, '入力した2は累積11ではなく今回やった2問として保存する');
assert.deepEqual(recorded.sessions.at(-1)?.progressRangesAdded, [{ start: 10, end: 11 }], '今回分を直前の未完了範囲へ割り当てる');
assert.deepEqual(recorded.materials[0].completedRanges, [{ start: 1, end: 11 }], '教材進捗は既存9問へ今回2問だけ加える');
assert.notEqual(recorded.lastScheduleResult?.status, 'invalidInput', '当日の旧タスク範囲との重複で記録を拒否しない');
const completed = recorded.materials[0].completedRanges ?? [];
for (const planned of recorded.tasks.filter((item) => item.status === 'planned' && item.type !== 'review' && item.materialId === material.id)) {
  const range = planned.materialRange ?? (planned.rangeStart !== null && planned.rangeEnd !== null
    ? { start: planned.rangeStart, end: planned.rangeEnd }
    : undefined);
  if (!range) continue;
  assert.equal(completed.some((done) => range.start <= done.end && range.end >= done.start), false, `再計画後の${range.start}〜${range.end}は完了済み範囲と重複しない`);
}

console.log('✅ record sheet state reset, timer duration editing, and taskless progress regressions passed');
