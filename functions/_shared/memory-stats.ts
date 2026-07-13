import type { AffectedStatTarget, MemoryMode, MemoryTargetType } from './memory-types';

interface AggregateRow {
  attempts: number;
  correct_count: number;
  partial_count: number;
  incorrect_count: number;
  skipped_count: number;
  consecutive_correct: number;
  consecutive_incorrect: number;
  average_response_ms: number;
  hint_count: number;
  last_attempt_at: string | null;
  recent_miss_score: number;
  normalized_response_score: number;
}

interface ExistingStatRow extends Omit<AggregateRow, 'recent_miss_score' | 'normalized_response_score'> {
  id: string;
  target_type: MemoryTargetType;
  target_id: string;
  mode: MemoryMode;
  manual_weak: number;
  weakness_score: number;
  updated_at: string;
  revision: number;
}

export interface MemoryStatRecord {
  id: string;
  targetType: MemoryTargetType;
  targetId: string;
  mode: MemoryMode;
  attempts: number;
  correctCount: number;
  partialCount: number;
  incorrectCount: number;
  skippedCount: number;
  consecutiveCorrect: number;
  consecutiveIncorrect: number;
  averageResponseMs: number;
  hintCount: number;
  manualWeak: boolean;
  weaknessScore: number;
  lastAttemptAt?: string;
  updatedAt: string;
  /** Sync-only optimistic-concurrency revision. */
  revision: number;
}

export interface DerivedMemoryStat {
  currentRevision: number;
  current: MemoryStatRecord | null;
  record: MemoryStatRecord;
  unchanged: boolean;
}

const TARGET_COLUMN: Readonly<Record<MemoryTargetType, 'sense_id' | 'answer_id' | 'exercise_id'>> = {
  sense: 'sense_id',
  answer: 'answer_id',
  exercise: 'exercise_id',
};

const MODE_ORDER: readonly MemoryMode[] = ['input', 'output', 'context', 'composition'];

export function statTargetKey(targetType: MemoryTargetType, targetId: string): string {
  return `${targetType}:${targetId}`;
}

export function addAffectedStatTarget(
  targets: Map<string, AffectedStatTarget>,
  targetType: MemoryTargetType,
  targetId: string | undefined,
  mode: MemoryMode,
): void {
  if (!targetId) return;
  const key = statTargetKey(targetType, targetId);
  const current = targets.get(key);
  if (current) current.modes.add(mode);
  else targets.set(key, { targetType, targetId, modes: new Set([mode]) });
}

async function aggregateTarget(
  db: D1Database,
  userId: string,
  targetType: MemoryTargetType,
  targetId: string,
  mode: MemoryMode,
): Promise<AggregateRow> {
  const column = TARGET_COLUMN[targetType];
  const row = await db.prepare(
    `WITH raw AS (
       SELECT a.assessment, a.response_ms, a.hint_used, a.created_at, a.attempt_id,
              (
                CASE a.exercise_type
                  WHEN 'flashcard' THEN 3500 WHEN 'typed_output' THEN 7000
                  WHEN 'fill_blank' THEN 6000 WHEN 'reorder' THEN 8000
                  WHEN 'multiple_choice' THEN 4500 WHEN 'guided_composition' THEN 14000
                  WHEN 'free_composition' THEN 24000 ELSE 7000
                END
                + LENGTH(COALESCE(CASE
                    WHEN a.exercise_id IS NOT NULL THEN e.prompt
                    WHEN a.mode = 'input' THEN i.label
                    ELSE s.prompt_ja
                  END, '')) * CASE
                    WHEN a.exercise_type IN ('guided_composition', 'free_composition') THEN 90 ELSE 24
                  END
                + LENGTH(COALESCE(a.normalized_answer, a.user_answer, '')) * CASE
                    WHEN a.exercise_type IN ('guided_composition', 'free_composition') THEN 170
                    WHEN a.exercise_type = 'typed_output' THEN 95 ELSE 35
                  END
              ) AS response_baseline
       FROM memory_attempts a
       LEFT JOIN memory_attempt_voids v
         ON v.user_id = a.user_id AND v.attempt_id = a.attempt_id
       LEFT JOIN memory_exercises e
         ON e.user_id = a.user_id AND e.id = a.exercise_id
       LEFT JOIN memory_senses s
         ON s.user_id = a.user_id AND s.id = a.sense_id
       LEFT JOIN memory_items i
         ON i.user_id = a.user_id AND i.id = a.item_id
       WHERE a.user_id = ? AND a.${column} = ? AND a.mode = ? AND v.void_id IS NULL
     ), relevant AS (
       SELECT raw.*,
              ROW_NUMBER() OVER (ORDER BY created_at DESC, attempt_id DESC) AS rn,
              MAX(0.0, MIN(1.0, (response_ms * 1.0 / NULLIF(response_baseline, 0) - 0.8) / 2.2))
                AS normalized_response_score
       FROM raw
     )
     SELECT
       COUNT(*) AS attempts,
       COALESCE(SUM(CASE WHEN assessment = 'correct' THEN 1 ELSE 0 END), 0) AS correct_count,
       COALESCE(SUM(CASE WHEN assessment = 'partial' THEN 1 ELSE 0 END), 0) AS partial_count,
       COALESCE(SUM(CASE WHEN assessment = 'incorrect' THEN 1 ELSE 0 END), 0) AS incorrect_count,
       COALESCE(SUM(CASE WHEN assessment = 'skipped' THEN 1 ELSE 0 END), 0) AS skipped_count,
       COALESCE(MIN(CASE WHEN assessment <> 'correct' THEN rn END) - 1, COUNT(*)) AS consecutive_correct,
       COALESCE(MIN(CASE WHEN assessment NOT IN ('incorrect', 'skipped') THEN rn END) - 1, COUNT(*)) AS consecutive_incorrect,
       COALESCE(CAST(ROUND(AVG(response_ms)) AS INTEGER), 0) AS average_response_ms,
       COALESCE(SUM(hint_used), 0) AS hint_count,
       MAX(created_at) AS last_attempt_at,
       COALESCE(AVG(normalized_response_score), 0) AS normalized_response_score,
       COALESCE(
         SUM(CASE WHEN rn <= 5 THEN
           (CASE rn WHEN 1 THEN 1.0 WHEN 2 THEN 0.8 WHEN 3 THEN 0.6 WHEN 4 THEN 0.4 ELSE 0.2 END) *
           (CASE assessment WHEN 'incorrect' THEN 1.0 WHEN 'skipped' THEN 1.0 WHEN 'partial' THEN 0.5 ELSE 0.0 END)
         ELSE 0 END) /
         NULLIF(SUM(CASE WHEN rn <= 5 THEN CASE rn WHEN 1 THEN 1.0 WHEN 2 THEN 0.8 WHEN 3 THEN 0.6 WHEN 4 THEN 0.4 ELSE 0.2 END ELSE 0 END), 0),
         0
       ) AS recent_miss_score
     FROM relevant`,
  ).bind(userId, targetId, mode).first<AggregateRow>();

  return row ?? {
    attempts: 0,
    correct_count: 0,
    partial_count: 0,
    incorrect_count: 0,
    skipped_count: 0,
    consecutive_correct: 0,
    consecutive_incorrect: 0,
    average_response_ms: 0,
    hint_count: 0,
    last_attempt_at: null,
    recent_miss_score: 0,
    normalized_response_score: 0,
  };
}

function mastery(row: Pick<AggregateRow, 'attempts' | 'correct_count' | 'partial_count'>): number {
  if (row.attempts === 0) return 0;
  return (row.correct_count + row.partial_count * 0.5 + 1) / (row.attempts + 2);
}

async function storedMastery(
  db: D1Database,
  userId: string,
  targetType: MemoryTargetType,
  targetId: string,
  mode: MemoryMode,
): Promise<number> {
  const row = await db.prepare(
    `SELECT attempts, correct_count, partial_count
     FROM memory_stats
     WHERE user_id = ? AND target_type = ? AND target_id = ? AND mode = ?`,
  ).bind(userId, targetType, targetId, mode).first<Pick<AggregateRow, 'attempts' | 'correct_count' | 'partial_count'>>();
  return row ? mastery(row) : 0;
}

function sameDerivedValues(current: ExistingStatRow | null, next: MemoryStatRecord): boolean {
  if (!current) return false;
  return current.attempts === next.attempts
    && current.correct_count === next.correctCount
    && current.partial_count === next.partialCount
    && current.incorrect_count === next.incorrectCount
    && current.skipped_count === next.skippedCount
    && current.consecutive_correct === next.consecutiveCorrect
    && current.consecutive_incorrect === next.consecutiveIncorrect
    && current.average_response_ms === next.averageResponseMs
    && current.hint_count === next.hintCount
    && Boolean(current.manual_weak) === next.manualWeak
    && Math.abs(current.weakness_score - Number(next.weaknessScore)) < 0.001
    && (current.last_attempt_at ?? undefined) === next.lastAttemptAt;
}

function rowToMemoryStat(row: ExistingStatRow): MemoryStatRecord {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    mode: row.mode,
    attempts: row.attempts,
    correctCount: row.correct_count,
    partialCount: row.partial_count,
    incorrectCount: row.incorrect_count,
    skippedCount: row.skipped_count,
    consecutiveCorrect: row.consecutive_correct,
    consecutiveIncorrect: row.consecutive_incorrect,
    averageResponseMs: row.average_response_ms,
    hintCount: row.hint_count,
    manualWeak: Boolean(row.manual_weak),
    weaknessScore: row.weakness_score,
    ...(row.last_attempt_at === null ? {} : { lastAttemptAt: row.last_attempt_at }),
    updatedAt: row.updated_at,
    revision: row.revision,
  };
}

async function loadExistingStat(
  db: D1Database,
  userId: string,
  targetType: MemoryTargetType,
  targetId: string,
  mode: MemoryMode,
): Promise<ExistingStatRow | null> {
  const id = `${targetType}:${targetId}:${mode}`;
  return db.prepare(
    `SELECT id, target_type, target_id, mode, attempts, correct_count, partial_count, incorrect_count,
            skipped_count, consecutive_correct, consecutive_incorrect, average_response_ms, hint_count,
            manual_weak, weakness_score, last_attempt_at, updated_at, revision
     FROM memory_stats WHERE user_id = ? AND id = ?`,
  ).bind(userId, id).first<ExistingStatRow>();
}

export async function getStoredMemoryStat(
  db: D1Database,
  userId: string,
  targetType: MemoryTargetType,
  targetId: string,
  mode: MemoryMode,
): Promise<MemoryStatRecord | null> {
  const row = await loadExistingStat(db, userId, targetType, targetId, mode);
  return row ? rowToMemoryStat(row) : null;
}

export async function deriveMemoryStat(
  db: D1Database,
  userId: string,
  targetType: MemoryTargetType,
  targetId: string,
  mode: MemoryMode,
  updatedAt: string,
  manualWeakOverride?: boolean,
): Promise<DerivedMemoryStat | null> {
  const id = `${targetType}:${targetId}:${mode}`;
  const current = await loadExistingStat(db, userId, targetType, targetId, mode);
  const aggregate = await aggregateTarget(db, userId, targetType, targetId, mode);
  if (aggregate.attempts === 0 && !current && manualWeakOverride === undefined) return null;

  const adjustedErrorRate = (aggregate.incorrect_count + aggregate.partial_count * 0.5 + 1) / (aggregate.attempts + 3);
  const hintRate = aggregate.attempts === 0 ? 0 : aggregate.hint_count / aggregate.attempts;
  const currentMastery = mastery(aggregate);
  let directionGap = 0;
  if (mode === 'output') {
    directionGap = Math.max(0, await storedMastery(db, userId, targetType, targetId, 'input') - currentMastery);
  } else if (mode === 'context') {
    directionGap = Math.max(0, await storedMastery(db, userId, targetType, targetId, 'output') - currentMastery);
  }
  const lowEvidenceScore = Math.max(0, 1 - aggregate.attempts / 5);
  const manualWeak = manualWeakOverride ?? Boolean(current?.manual_weak);
  const rawWeakness = 100 * Math.max(0, Math.min(1,
    0.32 * adjustedErrorRate
      + 0.18 * aggregate.recent_miss_score
      + 0.12 * aggregate.normalized_response_score
      + 0.10 * hintRate
      + 0.12 * directionGap
      + 0.08 * lowEvidenceScore
      + 0.08 * (manualWeak ? 1 : 0),
  ));
  const weaknessScore = Math.round(rawWeakness * 100) / 100;
  const record: MemoryStatRecord = {
    id,
    targetType,
    targetId,
    mode,
    attempts: aggregate.attempts,
    correctCount: aggregate.correct_count,
    partialCount: aggregate.partial_count,
    incorrectCount: aggregate.incorrect_count,
    skippedCount: aggregate.skipped_count,
    consecutiveCorrect: aggregate.consecutive_correct,
    consecutiveIncorrect: aggregate.consecutive_incorrect,
    averageResponseMs: aggregate.average_response_ms,
    hintCount: aggregate.hint_count,
    manualWeak,
    weaknessScore,
    ...(aggregate.last_attempt_at === null ? {} : { lastAttemptAt: aggregate.last_attempt_at }),
    updatedAt,
    revision: (current?.revision ?? 0) + 1,
  };
  return {
    currentRevision: current?.revision ?? 0,
    current: current ? rowToMemoryStat(current) : null,
    record,
    unchanged: sameDerivedValues(current, record),
  };
}

export function memoryStatWriteStatement(
  db: D1Database,
  userId: string,
  derived: DerivedMemoryStat,
  mutationMarker: string,
): D1PreparedStatement {
  const record = derived.record;
  const values = [
    record.attempts, record.correctCount, record.partialCount, record.incorrectCount,
    record.skippedCount, record.consecutiveCorrect, record.consecutiveIncorrect,
    record.averageResponseMs, record.hintCount, record.manualWeak ? 1 : 0,
    record.weaknessScore, record.lastAttemptAt ?? null, record.updatedAt, record.revision,
    mutationMarker,
  ];
  if (derived.currentRevision === 0) {
    return db.prepare(
      `INSERT OR IGNORE INTO memory_stats (
         user_id, id, target_type, target_id, mode, attempts, correct_count, partial_count,
         incorrect_count, skipped_count, consecutive_correct, consecutive_incorrect,
         average_response_ms, hint_count, manual_weak, weakness_score, last_attempt_at, updated_at,
         revision, last_mutation_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(userId, record.id, record.targetType, record.targetId, record.mode, ...values);
  }
  return db.prepare(
    `UPDATE memory_stats SET
       attempts = ?, correct_count = ?, partial_count = ?, incorrect_count = ?, skipped_count = ?,
       consecutive_correct = ?, consecutive_incorrect = ?, average_response_ms = ?, hint_count = ?,
       manual_weak = ?, weakness_score = ?, last_attempt_at = ?, updated_at = ?, revision = ?,
       last_mutation_id = ?
     WHERE user_id = ? AND id = ? AND revision = ?`,
  ).bind(...values, userId, record.id, derived.currentRevision);
}

export function memoryStatChangeStatement(
  db: D1Database,
  userId: string,
  record: MemoryStatRecord,
  mutationMarker: string,
  changedAt: string,
): D1PreparedStatement {
  return db.prepare(
    `INSERT OR IGNORE INTO memory_sync_changes
       (user_id, collection_name, entity_type, entity_key, revision, record_json, changed_at)
     SELECT ?, 'stats', 'stat', ?, ?, ?, ?
     FROM memory_stats
     WHERE user_id = ? AND id = ? AND revision = ? AND last_mutation_id = ?`,
  ).bind(
    userId, record.id, record.revision, JSON.stringify(record), changedAt,
    userId, record.id, record.revision, mutationMarker,
  );
}

async function recomputeOne(
  db: D1Database,
  userId: string,
  targetType: MemoryTargetType,
  targetId: string,
  mode: MemoryMode,
  now: string,
): Promise<void> {
  // Concurrent attempt uploads and manual-weak toggles can touch the same stat.
  // Optimistic conditional writes avoid overwriting either; retry from the
  // append-only Attempt log until the derived row converges.
  for (let retry = 0; retry < 4; retry += 1) {
    const derived = await deriveMemoryStat(db, userId, targetType, targetId, mode, now);
    if (!derived || derived.unchanged) return;
    const marker = `stat_recompute:${crypto.randomUUID()}`;
    const results = await db.batch([
      memoryStatWriteStatement(db, userId, derived, marker),
      memoryStatChangeStatement(db, userId, derived.record, marker, now),
    ]);
    if ((results[0]?.meta.changes ?? 0) === 1) return;
  }
  throw new Error(`Could not converge memory stat ${targetType}:${targetId}:${mode}`);
}

export async function recomputeAffectedStats(
  db: D1Database,
  userId: string,
  targets: Map<string, AffectedStatTarget>,
  now: string,
): Promise<void> {
  for (const target of targets.values()) {
    const modes = new Set(target.modes);
    if (modes.has('input')) modes.add('output');
    if (modes.has('output')) modes.add('context');
    for (const mode of MODE_ORDER) {
      if (modes.has(mode)) await recomputeOne(db, userId, target.targetType, target.targetId, mode, now);
    }
  }
}
