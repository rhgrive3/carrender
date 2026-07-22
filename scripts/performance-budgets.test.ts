import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { decodeAppStateChunks, encodeAppStateChunks } from '../src/lib/appStateChunks';
import { addDays } from '../src/lib/date';
import { generatePlan } from '../src/lib/scheduler';
import { migrateState } from '../src/lib/storage';
import type { AppState, Material, StudySession, Subject } from '../src/types';
import { emptyState } from '../src/state/AppContext';
import type { LocalMemoryAttempt, MemorySyncCommit } from '../src/features/memory/infrastructure/repositories';
import { MemoryRepository } from '../src/features/memory/infrastructure/repositories';
import { flushMemorySync } from '../src/features/memory/infrastructure/syncEngine';

const nightly = process.env.PERF_SCALE === 'nightly';
const ATTEMPT_COUNT = nightly ? 100_000 : 20_000;
const SESSION_COUNT = nightly ? 50_000 : 10_000;
const MATERIAL_COUNT = nightly ? 160 : 60;
const SYNC_SAMPLE_COUNT = nightly ? 2_000 : 400;
const budgets = {
  fixtureMs: nightly ? 6_000 : 2_000,
  historySearchMs: nightly ? 2_000 : 700,
  encodeMs: nightly ? 20_000 : 8_000,
  decodeMs: nightly ? 20_000 : 8_000,
  migrateMs: nightly ? 20_000 : 8_000,
  replanMs: nightly ? 45_000 : 15_000,
  syncDrainMs: nightly ? 20_000 : 8_000,
  heapDeltaMb: nightly ? 768 : 384,
};

type MetricName = keyof typeof budgets;
const metrics: Partial<Record<MetricName, number>> = {};

async function measure<T>(name: MetricName, operation: () => T | Promise<T>): Promise<T> {
  const startedAt = performance.now();
  const result = await operation();
  const elapsed = performance.now() - startedAt;
  metrics[name] = elapsed;
  const budget = budgets[name];
  console.log(`${name}: ${elapsed.toFixed(1)}ms / budget ${budget}ms (${(elapsed / budget).toFixed(2)}x)`);
  assert.ok(elapsed <= budget, `${name} exceeded budget: ${elapsed.toFixed(1)}ms > ${budget}ms`);
  return result;
}

function dateAfter(days: number): string {
  return addDays('2026-01-01', days);
}

function createMainFixture(): AppState {
  const base = emptyState();
  const createdAt = '2026-01-01T00:00:00.000Z';
  const subjects: Subject[] = Array.from({ length: 10 }, (_, index) => ({
    id: `subject-${index}`,
    name: `科目${index}`,
    color: `hsl(${index * 36} 70% 50%)`,
    importance: ((index % 5) + 1) as Subject['importance'],
    weakness: (((index + 2) % 5) + 1) as Subject['weakness'],
  }));
  const materials: Material[] = Array.from({ length: MATERIAL_COUNT }, (_, index) => ({
    id: `material-${index}`,
    subjectId: subjects[index % subjects.length].id,
    name: `性能教材${index}`,
    unit: '問題',
    totalAmount: 120,
    doneAmount: index % 20,
    completedRanges: index % 20 > 0 ? [{ start: 1, end: index % 20 }] : [],
    totalUnits: 120,
    startDate: dateAfter(index % 30),
    targetDate: dateAfter(180 + (index % 120)),
    priority: ((index % 5) + 1) as Material['priority'],
    difficulty: (((index + 1) % 5) + 1) as Material['difficulty'],
    minutesPerUnit: 10 + (index % 4) * 5,
    unitStep: 1,
    splittable: true,
    preferredCadence: { type: 'timesPerWeek', count: (index % 5) + 1 },
    dailyTarget: null,
    weeklyTarget: (index % 5) + 1,
    deadlinePolicy: index % 5 === 0 ? 'strict' : 'normal',
    examRelevance: (((index + 3) % 5) + 1) as Material['examRelevance'],
    reviewEnabled: index % 3 === 0,
    reviewIntervals: [1, 3, 7, 14],
    paused: false,
    round: 1,
    archived: false,
    createdAt,
  }));
  const sessions: StudySession[] = Array.from({ length: SESSION_COUNT }, (_, index) => {
    const material = materials[index % materials.length];
    const date = dateAfter(index % 1_095);
    return {
      id: `session-${index}`,
      taskId: null,
      subjectId: material.subjectId,
      materialId: material.id,
      date,
      startedAt: `${date}T12:00:00.000Z`,
      minutes: 20 + (index % 8) * 5,
      amountDone: index % 3,
      rangeLabel: `${(index % 120) + 1}`,
      focus: (((index % 5) + 1) as StudySession['focus']),
      memo: `性能fixture-${index}`,
      source: 'manual',
      updatedAt: `${date}T12:30:00.000Z`,
    };
  });
  return {
    ...base,
    onboarded: true,
    goal: { id: 'goal-performance', name: '性能検証', examDate: '2027-12-31', createdAt },
    subjects,
    materials,
    sessions,
    availability: base.availability.map((slot) => ({ ...slot, minutes: 240, windows: [{ start: '18:00', end: '22:00' }] })),
    settings: { ...base.settings, maxDailyMinutes: 240, taskGenerationHorizonDays: 365 },
  };
}

function createAttempts(): LocalMemoryAttempt[] {
  return Array.from({ length: ATTEMPT_COUNT }, (_, index) => ({
    attemptId: `attempt-${index}`,
    sessionId: `memory-session-${Math.floor(index / 20)}`,
    clientId: 'performance-client',
    itemId: `item-${index % 2_000}`,
    senseId: `sense-${index % 4_000}`,
    targetId: `target-${index % 1_000}`,
    mode: 'output',
    exerciseType: 'flashcard',
    assessment: index % 4 === 0 ? 'incorrect' : 'correct',
    errorTypes: [],
    hintUsed: index % 9 === 0,
    responseMs: 300 + (index % 5_000),
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index % 1_440)).toISOString(),
    ...(index % 3 === 0 ? { syncedAt: '2026-01-02T00:00:00.000Z' } : {}),
  }));
}

class PerformanceSyncRepository extends MemoryRepository {
  private attempts: LocalMemoryAttempt[];
  private cursorValue: string | undefined;

  constructor(attempts: LocalMemoryAttempt[]) {
    super('performance-sync');
    this.attempts = attempts;
  }

  override async clientId(): Promise<string> { return 'performance-client'; }
  override async syncCursor(): Promise<string | undefined> { return this.cursorValue; }
  override async syncablePendingMutations(): Promise<[]> { return []; }
  override async unsyncedAttempts(limit = 20): Promise<LocalMemoryAttempt[]> {
    return this.attempts.filter((attempt) => !attempt.syncedAt).slice(0, limit);
  }
  override async commitSyncResponse(response: MemorySyncCommit): Promise<void> {
    const accepted = new Set(response.acceptedAttemptIds);
    this.attempts = this.attempts.map((attempt) => accepted.has(attempt.attemptId)
      ? { ...attempt, syncedAt: response.serverTime }
      : attempt);
    this.cursorValue = response.cursor;
  }
  remaining(): number { return this.attempts.filter((attempt) => !attempt.syncedAt).length; }
}

const heapBefore = process.memoryUsage().heapUsed;
const fixture = await measure('fixtureMs', () => createMainFixture());
const attempts = createAttempts();
const heapDeltaMb = Math.max(0, process.memoryUsage().heapUsed - heapBefore) / (1024 * 1024);
metrics.heapDeltaMb = heapDeltaMb;
console.log(`heapDeltaMb: ${heapDeltaMb.toFixed(1)}MiB / budget ${budgets.heapDeltaMb}MiB (${(heapDeltaMb / budgets.heapDeltaMb).toFixed(2)}x)`);
assert.ok(heapDeltaMb <= budgets.heapDeltaMb, `fixture heap delta exceeded budget: ${heapDeltaMb.toFixed(1)}MiB`);
assert.equal(attempts.length, ATTEMPT_COUNT, '決定的fixtureが指定件数のattemptを生成する');

await measure('historySearchMs', () => {
  const result = attempts
    .filter((attempt) => attempt.targetId === 'target-42' && !attempt.undoneAt)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 50);
  assert.ok(result.length > 0, '大規模履歴から対象attemptを検索できる');
});

const encoded = await measure('encodeMs', () => encodeAppStateChunks(fixture));
const decoded = await measure('decodeMs', () => decodeAppStateChunks(encoded.manifest, encoded.chunks));
assert.equal(decoded.sessions.length, SESSION_COUNT, 'chunk復元後もsession件数を維持する');
const migration = await measure('migrateMs', () => migrateState(fixture));
assert.ok(migration.ok && migration.state.sessions.length === SESSION_COUNT, '大規模AppStateを移行できる');

const replanInput = { ...fixture, sessions: fixture.sessions.slice(-Math.min(2_000, fixture.sessions.length)) };
const planned = await measure('replanMs', () => generatePlan(replanInput, '2026-01-01', '性能budget'));
assert.ok(planned.state.tasks.length >= 0 && planned.report, '再計画が結果とreportを返す');

const syncAttempts = attempts.slice(0, SYNC_SAMPLE_COUNT).map((attempt) => ({ ...attempt, syncedAt: undefined }));
const repository = new PerformanceSyncRepository(syncAttempts);
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body ?? '{}')) as { attempts?: LocalMemoryAttempt[] };
    const acceptedAttemptIds = (request.attempts ?? []).map((attempt) => attempt.attemptId);
    return new Response(JSON.stringify({
      schemaVersion: 1,
      serverTime: '2026-07-23T00:00:00.000Z',
      cursor: `cursor-${acceptedAttemptIds.at(-1) ?? 'empty'}`,
      acceptedMutationIds: [],
      acceptedAttemptIds,
      conflicts: [],
      changes: {},
      hasMore: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const syncResult = await measure('syncDrainMs', () => flushMemorySync(
    repository,
    Math.ceil(SYNC_SAMPLE_COUNT / 2) + 5,
    { force: true, random: () => 0.5 },
  ));
  assert.equal(repository.remaining(), 0, '同期sample queueを最後までdrainする');
  assert.equal(syncResult.hasMore, false, 'drain完了後は残件なしを返す');
} finally {
  globalThis.fetch = originalFetch;
}

console.log(JSON.stringify({
  scale: nightly ? 'nightly' : 'pr',
  counts: { attempts: ATTEMPT_COUNT, sessions: SESSION_COUNT, materials: MATERIAL_COUNT, syncSample: SYNC_SAMPLE_COUNT },
  metrics,
}, null, 2));
console.log('🎉 ALL PASS (performance budgets)');
