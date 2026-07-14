/** Deterministic long-horizon performance budgets for the main planner state. */
/// <reference types="node" />
import { performance } from 'node:perf_hooks';
import type { AppState, Material, StudySession, Subject } from '../src/types';
import { decodeAppStateChunks, encodeAppStateChunks, MAX_MAIN_STATE_CHUNK_BYTES, utf8Length } from '../src/lib/appStateChunks';
import { migrateState } from '../src/lib/storage';
import { emptyState } from '../src/state/AppContext';

const MATERIAL_COUNT = 100;
const SESSION_COUNT = 10_000;
const THREE_YEARS_IN_DAYS = 1_095;
const MAX_ENCODE_MS = 8_000;
const MAX_DECODE_MS = 8_000;
const MAX_MIGRATE_MS = 8_000;
let failures = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.error(`  ❌ ${name}`, detail ?? '');
  }
}

function dateAfter(days: number): string {
  const date = new Date(Date.UTC(2026, 0, 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function createFixture(): AppState {
  const createdAt = '2026-01-01T00:00:00.000Z';
  const subjects: Subject[] = Array.from({ length: 10 }, (_, index) => ({
    id: `subject-${index}`,
    name: `科目${index}`,
    color: `hsl(${index * 36} 70% 50%)`,
    importance: (index % 5) + 1,
    weakness: ((index + 2) % 5) + 1,
  }));
  const materials: Material[] = Array.from({ length: MATERIAL_COUNT }, (_, index) => ({
    id: `material-${index}`,
    subjectId: subjects[index % subjects.length].id,
    name: `長期教材${index}`,
    unit: '講義',
    totalAmount: 240,
    doneAmount: index % 40,
    completedRanges: [],
    totalUnits: 240,
    startDate: dateAfter(index % 60),
    targetDate: dateAfter(600 + (index % 365)),
    priority: (index % 5) + 1,
    difficulty: ((index + 1) % 5) + 1,
    minutesPerUnit: 45 + (index % 4) * 15,
    unitStep: 1,
    splittable: true,
    preferredCadence: { type: 'timesPerWeek', count: (index % 6) + 1 },
    dailyTarget: null,
    weeklyTarget: (index % 6) + 1,
    deadlinePolicy: index % 4 === 0 ? 'strict' : 'normal',
    examRelevance: ((index + 3) % 5) + 1,
    reviewEnabled: index % 3 === 0,
    reviewIntervals: [1, 3, 7, 14],
    paused: false,
    round: 1,
    archived: false,
    createdAt,
  }));
  const sessions: StudySession[] = Array.from({ length: SESSION_COUNT }, (_, index) => {
    const material = materials[index % materials.length];
    const day = dateAfter(index % THREE_YEARS_IN_DAYS);
    return {
      id: `session-${index}`,
      taskId: null,
      subjectId: material.subjectId,
      materialId: material.id,
      date: day,
      startedAt: `${day}T12:00:00.000Z`,
      minutes: 25 + (index % 8) * 5,
      amountDone: index % 3,
      rangeLabel: `${(index % 240) + 1}講`,
      focus: (index % 5) + 1,
      memo: `長期性能fixture-${index}-${'復習記録'.repeat(30)}`,
      source: 'manual',
      updatedAt: `${day}T12:30:00.000Z`,
    };
  });

  return {
    ...emptyState(),
    onboarded: true,
    goal: {
      id: 'goal-performance',
      name: '長期運用性能検証',
      examDate: '2029-12-31',
      createdAt,
    },
    subjects,
    materials,
    sessions,
  };
}

console.log('--- Main state performance: 100 materials / 10,000 sessions / 3 years ---');
const fixture = createFixture();
const legacyBytes = utf8Length(JSON.stringify(fixture));
check('fixtureが旧5MiB blob制限を超える', legacyBytes > 5 * 1024 * 1024, legacyBytes);

const encodeStartedAt = performance.now();
const encoded = await encodeAppStateChunks(fixture);
const encodeMs = performance.now() - encodeStartedAt;
check(`encode ${encodeMs.toFixed(1)}ms <= ${MAX_ENCODE_MS}ms`, encodeMs <= MAX_ENCODE_MS, encodeMs);
check('全chunkが384KiB上限内', encoded.chunks.every((chunk) => chunk.byteLength <= MAX_MAIN_STATE_CHUNK_BYTES), Math.max(...encoded.chunks.map((chunk) => chunk.byteLength)));
check('大容量fixtureが複数chunkへ分割される', encoded.chunks.length > 10, encoded.manifest);

const decodeStartedAt = performance.now();
const decoded = await decodeAppStateChunks(encoded.manifest, encoded.chunks);
const decodeMs = performance.now() - decodeStartedAt;
check(`decode ${decodeMs.toFixed(1)}ms <= ${MAX_DECODE_MS}ms`, decodeMs <= MAX_DECODE_MS, decodeMs);
check('decode後の教材・記録件数を維持', decoded.materials.length === MATERIAL_COUNT && decoded.sessions.length === SESSION_COUNT, {
  materials: decoded.materials.length,
  sessions: decoded.sessions.length,
});
check('decode後の末尾記録を維持', decoded.sessions.at(-1)?.id === `session-${SESSION_COUNT - 1}`, decoded.sessions.at(-1));

const migrateStartedAt = performance.now();
const migration = migrateState(fixture);
const migrateMs = performance.now() - migrateStartedAt;
check(`migration ${migrateMs.toFixed(1)}ms <= ${MAX_MIGRATE_MS}ms`, migrateMs <= MAX_MIGRATE_MS, migrateMs);
check('migrationが大容量fixtureを拒否・欠落しない', migration.ok
  && migration.state.materials.length === MATERIAL_COUNT
  && migration.state.sessions.length === SESSION_COUNT, migration);

console.log(`\nmetrics: legacy=${legacyBytes} bytes chunks=${encoded.chunks.length} encode=${encodeMs.toFixed(1)}ms decode=${decodeMs.toFixed(1)}ms migrate=${migrateMs.toFixed(1)}ms`);
console.log(failures === 0 ? '\n🎉 ALL PASS (main state performance)' : `\n💥 ${failures} FAILURES (main state performance)`);
process.exit(failures === 0 ? 0 : 1);
