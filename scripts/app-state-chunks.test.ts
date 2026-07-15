/** Regression tests for the main AppState chunk codec. */
/// <reference types="node" />
import { isDeepStrictEqual } from 'node:util';
import type { AppState, StudySession } from '../src/types';
import { emptyState } from '../src/state/AppContext';
import {
  decodeAppStateChunks,
  encodeAppStateChunks,
  MAIN_STATE_CHUNK_FORMAT_VERSION,
  MAX_MAIN_STATE_CHUNK_BYTES,
  utf8Length,
  validateAppStateChunkManifest,
} from '../src/lib/appStateChunks';

type HistorySettingsView = {
  historyData?: {
    planRevisions: Array<{
      id: string;
      generationId: string;
      createdAt: string;
      reason: string;
      fromDate: string;
      placements: unknown[];
      changes: unknown[];
      materialChanges: unknown[];
    }>;
    monthlySummaries: unknown[];
  };
};

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures += 1; console.error(`  ❌ ${name}`, detail ?? ''); }
}

function baseState(): AppState {
  const now = '2026-07-14T00:00:00.000Z';
  return {
    ...emptyState(), onboarded: true,
    goal: { id: 'goal-1', name: '医学部合格', examDate: '2027-02-01', createdAt: now },
    subjects: [{ id: 'subject-1', name: '化学', color: '#123456', importance: 5, weakness: 4 }],
    materials: [{
      id: 'material-1', subjectId: 'subject-1', name: '化学特講', unit: '講義', totalAmount: 20,
      doneAmount: 0, completedRanges: [], totalUnits: 20, startDate: '2026-07-14', targetDate: '2026-08-20',
      priority: 5, difficulty: 4, minutesPerUnit: 60, unitStep: 1, splittable: true,
      preferredCadence: { type: 'timesPerWeek', count: 4 }, dailyTarget: null, weeklyTarget: 4,
      deadlinePolicy: 'strict', examRelevance: 5, reviewEnabled: false, reviewIntervals: [1, 3, 7],
      paused: false, round: 1, archived: false, createdAt: now,
    }],
  };
}

function session(index: number, memo = ''): StudySession {
  return {
    id: `session-${index}`, taskId: null, subjectId: 'subject-1', materialId: 'material-1', date: '2026-07-14',
    startedAt: `2026-07-14T00:${String(index % 60).padStart(2, '0')}:00.000Z`, minutes: 30, amountDone: 0,
    rangeLabel: '', focus: 4, memo, source: 'manual', updatedAt: '2026-07-14T00:00:00.000Z',
  };
}

console.log('--- AppState chunks: roundtrip ---');
const small = baseState();
small.sessions = [session(1, '復習')];
const encodedSmall = await encodeAppStateChunks(small, 1024);
const restoredSmall = await decodeAppStateChunks(encodedSmall.manifest, encodedSmall.chunks);
check('最新formatで保存する', encodedSmall.manifest.formatVersion === MAIN_STATE_CHUNK_FORMAT_VERSION, encodedSmall.manifest);
check('manifestを厳密検証できる', validateAppStateChunkManifest(encodedSmall.manifest), encodedSmall.manifest);
check('全sectionを欠落なく往復する', isDeepStrictEqual(restoredSmall, small), restoredSmall);
check('空sectionは0 chunkとして表現する', encodedSmall.manifest.sections.find((entry) => entry.name === 'tasks')?.chunkCount === 0);
check('全chunkが指定上限以下', encodedSmall.chunks.every((chunk) => chunk.byteLength <= 1024 && utf8Length(chunk.json) === chunk.byteLength));

console.log('--- AppState chunks: payload beyond legacy 5 MiB ---');
const large = baseState();
large.sessions = Array.from({ length: 9_000 }, (_, index) => session(index, `記録-${index}-${'化学'.repeat(180)}`));
const legacyBytes = utf8Length(JSON.stringify(large));
const encodedLarge = await encodeAppStateChunks(large);
const restoredLarge = await decodeAppStateChunks(encodedLarge.manifest, encodedLarge.chunks);
check('旧5MiB制限を超えるfixture', legacyBytes > 5 * 1024 * 1024, legacyBytes);
check('大容量状態を複数chunkへ分割', encodedLarge.chunks.length > 10 && encodedLarge.manifest.totalBytes > 5 * 1024 * 1024, encodedLarge.manifest);
check('既定384KiB上限を全chunkが守る', encodedLarge.chunks.every((chunk) => chunk.byteLength <= MAX_MAIN_STATE_CHUNK_BYTES));
check('大容量状態を全件復元する', restoredLarge.sessions.length === large.sessions.length && restoredLarge.sessions.at(-1)?.id === large.sessions.at(-1)?.id);

console.log('--- AppState chunks: oversized unknown settings recovery ---');
const contaminated = baseState();
const expectedSettings = JSON.parse(JSON.stringify(contaminated.settings)) as AppState['settings'];
const contaminatedSettings = contaminated.settings as AppState['settings'] & { legacyMemoryCache: string };
contaminatedSettings.legacyMemoryCache = 'x'.repeat(MAX_MAIN_STATE_CHUNK_BYTES * 3);
check(
  '未知設定を含む元payloadは単一chunk上限を超えるfixture',
  utf8Length(JSON.stringify([contaminated.settings])) > MAX_MAIN_STATE_CHUNK_BYTES,
);
const encodedContaminated = await encodeAppStateChunks(contaminated);
const restoredContaminated = await decodeAppStateChunks(encodedContaminated.manifest, encodedContaminated.chunks);
const contaminatedSettingsChunks = encodedContaminated.chunks.filter((chunk) => chunk.section === 'settings');
check('巨大な未知設定があっても同期用settingsを上限内で生成する', contaminatedSettingsChunks.length === 1 && contaminatedSettingsChunks[0].byteLength <= MAX_MAIN_STATE_CHUNK_BYTES, contaminatedSettingsChunks);
check('現行schema外の巨大設定をクラウドへ持ち越さない', !Object.prototype.hasOwnProperty.call(restoredContaminated.settings, 'legacyMemoryCache'));
check('利用中の設定値は欠落させない', isDeepStrictEqual(restoredContaminated.settings, expectedSettings), restoredContaminated.settings);

console.log('--- AppState chunks: large plan history inside settings ---');
const historyHeavy = baseState();
const placements = Array.from({ length: 5_000 }, (_, index) => ({
  key: `material|material-${index}|material-${index}|new|${index}-${index}`,
  taskId: `task-${index}`,
  title: `化学特講 ${index + 1}`,
  materialId: `material-${index}`,
  estimatedMinutes: 60,
  scheduledDate: '2026-07-20',
  scheduledStart: '09:00',
  scheduledEnd: '10:00',
  placementStatus: 'scheduled' as const,
  placementLock: 'none' as const,
  manualOrder: index,
}));
historyHeavy.settings = {
  ...historyHeavy.settings,
  historyData: {
    planRevisions: [{
      id: 'plan-revision:large:2026-07-14T00:00:00.000Z',
      generationId: 'large-history',
      createdAt: '2026-07-14T00:00:00.000Z',
      reason: '大量計画の再生成',
      fromDate: '2026-07-14',
      placements,
      changes: [],
      materialChanges: [],
    }],
    monthlySummaries: [],
  },
} as AppState['settings'] & HistorySettingsView;
const sourceHistoryData = (historyHeavy.settings as AppState['settings'] & HistorySettingsView).historyData;
const monolithicSettingsBytes = utf8Length(JSON.stringify([historyHeavy.settings]));
const encodedHistory = await encodeAppStateChunks(historyHeavy);
const restoredHistory = await decodeAppStateChunks(encodedHistory.manifest, encodedHistory.chunks);
const restoredHistoryData = (restoredHistory.settings as AppState['settings'] & HistorySettingsView).historyData;
const settingsManifest = encodedHistory.manifest.sections.find((entry) => entry.name === 'settings');
check('従来の単一settingsでは384KiBを超えるfixture', monolithicSettingsBytes > MAX_MAIN_STATE_CHUNK_BYTES, monolithicSettingsBytes);
check('計画履歴を明細単位へ分解して複数chunkへ保存', (settingsManifest?.chunkCount ?? 0) > 1, settingsManifest);
check('計画履歴を含む全chunkが384KiB以下', encodedHistory.chunks.every((chunk) => chunk.byteLength <= MAX_MAIN_STATE_CHUNK_BYTES));
check('分割した計画履歴を欠落なく復元', isDeepStrictEqual(restoredHistoryData, sourceHistoryData), {
  expected: sourceHistoryData?.planRevisions[0]?.placements.length,
  actual: restoredHistoryData?.planRevisions[0]?.placements.length,
});

console.log('--- AppState chunks: corruption detection ---');
const tampered = encodedSmall.chunks.map((chunk, index) => index === 0 ? { ...chunk, json: `${chunk.json} ` } : chunk);
let tamperRejected = false;
try { await decodeAppStateChunks(encodedSmall.manifest, tampered); } catch { tamperRejected = true; }
check('本文改変をbyte/hash検証で拒否', tamperRejected);

const oversized = baseState();
oversized.sessions = [session(1, 'x'.repeat(MAX_MAIN_STATE_CHUNK_BYTES + 1024))];
let oversizedRejected = false;
try { await encodeAppStateChunks(oversized); } catch { oversizedRejected = true; }
check('単一entityがchunk上限を超える場合は黙って分断しない', oversizedRejected);

console.log(failures === 0 ? '\n🎉 ALL PASS (AppState chunks)' : `\n💥 ${failures} FAILURES (AppState chunks)`);
process.exit(failures === 0 ? 0 : 1);
