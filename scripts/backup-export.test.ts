import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBackupState, exportJSON, importJSON } from '../src/lib/storage';
import type { AppState, StudySession, StudyTask } from '../src/types';
import type { PlanRevision } from '../src/lib/planHistory';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/strict-plan-quality-state.json', import.meta.url), 'utf8')) as AppState;
const material = fixture.materials.find((item) => item.id === 'mat_mrc2brcy_g_f0j1')!;
const task: StudyTask = {
  id: 'current-task',
  subjectId: material.subjectId,
  materialId: material.id,
  title: material.name,
  rangeLabel: '3〜4',
  rangeStart: 3,
  rangeEnd: 4,
  materialRange: { start: 3, end: 4 },
  amount: 2,
  estimatedMinutes: 90,
  priority: 95,
  dueDate: material.targetDate,
  type: 'new',
  status: 'planned',
  scheduledDate: '2026-07-20',
  scheduledStart: '20:30',
  scheduledEnd: '22:00',
  generatedBy: 'auto',
  reviewStage: null,
  sourceType: 'material',
  sourceId: material.id,
  placementStatus: 'scheduled',
  placementLock: 'none',
  createdAt: '2026-07-18T06:44:07.326Z',
  updatedAt: '2026-07-18T06:44:07.326Z',
  completedAt: null,
};
const session: StudySession = {
  id: 'session-current',
  taskId: task.id,
  subjectId: material.subjectId,
  materialId: material.id,
  date: '2026-07-18',
  startedAt: '2026-07-18T05:00:00.000Z',
  minutes: 45,
  amountDone: 1,
  rangeLabel: '2',
  focus: 4,
  memo: '保持対象',
  source: 'manual',
};
const largeTitle = '変更履歴の重複データ'.repeat(200);
const revisions: PlanRevision[] = Array.from({ length: 24 }, (_, revisionIndex) => ({
  id: `revision-${revisionIndex}`,
  generationId: `generation-${revisionIndex}`,
  createdAt: `2026-07-${String((revisionIndex % 18) + 1).padStart(2, '0')}T12:00:00.000Z`,
  reason: '再計算',
  fromDate: '2026-07-18',
  placements: Array.from({ length: 80 }, (_, placementIndex) => ({
    key: `material|${material.id}|${placementIndex}`,
    taskId: `history-task-${revisionIndex}-${placementIndex}`,
    title: largeTitle,
    materialId: material.id,
    estimatedMinutes: 90,
    scheduledDate: '2026-08-04',
    scheduledStart: '20:00',
    scheduledEnd: '21:30',
    placementStatus: 'scheduled',
    placementLock: 'none',
  })),
  changes: [],
  materialChanges: [],
}));

const state: AppState = {
  ...fixture,
  tasks: [task],
  sessions: [session],
  planHistory: [{
    id: 'missed:1',
    taskId: 'missed-task',
    subjectId: material.subjectId,
    materialId: material.id,
    title: material.name,
    scheduledDate: '2026-07-17',
    estimatedMinutes: 45,
    amount: 1,
    type: 'new',
    outcome: 'missed',
    rangeStart: 1,
    rangeEnd: 1,
    materialRange: { start: 1, end: 1 },
    capturedAt: '2026-07-18T00:00:00.000Z',
  }],
  settings: {
    ...fixture.settings,
    historyData: {
      planRevisions: revisions,
      monthlySummaries: [{
        month: '2026-06',
        studyMinutes: 600,
        sessionCount: 10,
        completedTaskCount: 4,
        plannedMinutes: 720,
        missedMinutes: 90,
        subjectMinutes: [{ subjectId: material.subjectId, minutes: 600 }],
      }],
    },
  },
};

const fullPretty = JSON.stringify(state, null, 2);
const backupState = createBackupState(state);
const exported = exportJSON(state);
const parsed = JSON.parse(exported) as AppState;

assert.equal(exported.includes('\n'), false, '機械復元用JSONへ不要なインデント・改行を入れない');
assert.equal(parsed.settings.historyData?.planRevisions.length, 0, '計画の変更履歴をバックアップから除外する');
assert.deepEqual(parsed.settings.historyData?.monthlySummaries, state.settings.historyData?.monthlySummaries, '長期分析に必要な月次集計は保持する');
assert.deepEqual(parsed.planHistory, state.planHistory, '未達履歴は保持する');
assert.deepEqual(parsed.tasks, state.tasks, '現在の予定は保持する');
assert.deepEqual(parsed.sessions, state.sessions, '学習記録は保持する');
assert.equal(state.settings.historyData?.planRevisions.length, 24, '書き出し元のアプリ状態を変更しない');
assert.notEqual(backupState, state, '履歴がある場合だけ非破壊の書き出し状態を作る');
assert.ok(exported.length < fullPretty.length / 10, '重複する計画スナップショットを除外して容量を大幅に削減する');

const restored = importJSON(exported);
assert.deepEqual(restored.tasks.map((item) => item.id), [task.id], 'コンパクトバックアップから現在予定を復元できる');
assert.deepEqual(restored.sessions.map((item) => item.id), [session.id], 'コンパクトバックアップから学習記録を復元できる');
assert.deepEqual(restored.planHistory?.map((item) => item.id), ['missed:1'], 'コンパクトバックアップから未達履歴を復元できる');

const settingsSource = readFileSync(new URL('../src/screens/SettingsSheet.tsx', import.meta.url), 'utf8');
assert.match(settingsSource, /バックアップ（変更履歴は除外）/, 'データ管理の要約で除外を明示する');
assert.match(settingsSource, /「計画の変更履歴」はバックアップに含めません/, '書き出し前に除外対象と理由を明示する');
assert.match(settingsSource, /教材・現在の予定・学習記録・未達履歴・設定を保存します/, 'バックアップに含む主要データも明示する');
assert.match(settingsSource, /バックアップを書き出す/, '操作名を用途が分かる表現にする');

console.log('✅ compact backup export regressions passed');
