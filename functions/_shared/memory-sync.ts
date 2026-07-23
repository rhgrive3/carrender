import type { Env } from './env';
import { MemoryValidationError } from './memory-validation';
import {
  addAffectedStatTarget,
  deriveMemoryStat,
  getStoredMemoryStat,
  memoryStatChangeStatement,
  memoryStatWriteStatement,
  recomputeAffectedStats,
} from './memory-stats';
import type {
  AffectedStatTarget,
  MemoryAttemptInput,
  MemoryConflictOutput,
  MemoryEntityType,
  MemoryMode,
  MemoryMutationInput,
  MemoryRemoteChanges,
  MemorySyncInput,
  MemorySyncOutput,
} from './memory-types';

// Keep response buffering bounded even when content fields are large. The
// browser follows hasMore/cursor pages, so a cold start still drains fully.
const PULL_LIMIT = 100;

interface StoredRecordRow {
  data_json: string;
  revision: number;
  source: string | null;
  verification_status: string | null;
  created_at: string;
}

interface StoredMutationRow {
  request_hash: string;
  status: 'applied' | 'conflict';
  result_json: string;
}

interface EntityStorage {
  table: string;
  collection: keyof MemoryRemoteChanges;
  keyColumns: string[];
  keyValues: string[];
  extraColumns: string[];
  extraValues: unknown[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  incomingRevision?: number;
  source?: string;
  verificationStatus?: string;
}

interface AttemptRow {
  attempt_id: string;
  session_id: string;
  client_id: string;
  item_id: string;
  sense_id: string;
  answer_id: string | null;
  exercise_id: string | null;
  target_id: string;
  mode: MemoryMode;
  exercise_type: string;
  user_answer: string | null;
  normalized_answer: string | null;
  assessment: 'correct' | 'partial' | 'incorrect' | 'skipped';
  error_types_json: string;
  hint_used: number;
  response_ms: number;
  created_at: string;
  server_received_at: string;
}

interface ApplyMutationResult {
  conflict?: MemoryConflictOutput;
  affectedAttempt?: AttemptRow;
  deferred?: boolean;
}

function requiredRecordString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new MemoryValidationError(`Validated record is missing ${key}`);
  return value;
}

function optionalRecordString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === undefined) return null;
  if (typeof value !== 'string') throw new MemoryValidationError(`Validated record has an invalid ${key}`);
  return value;
}

function requiredRecordNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number') throw new MemoryValidationError(`Validated record is missing ${key}`);
  return value;
}

function storageFor(mutation: MemoryMutationInput): EntityStorage {
  const value = mutation.payload;
  const commonRevisioned = () => ({
    createdAt: requiredRecordString(value, 'createdAt'),
    updatedAt: requiredRecordString(value, 'updatedAt'),
    deletedAt: optionalRecordString(value, 'deletedAt'),
    incomingRevision: requiredRecordNumber(value, 'revision'),
  });
  switch (mutation.entityType) {
    case 'set':
      return {
        table: 'memory_sets', collection: 'sets', keyColumns: ['id'], keyValues: [mutation.entityId],
        extraColumns: ['name'], extraValues: [requiredRecordString(value, 'name')], ...commonRevisioned(),
      };
    case 'item':
      return {
        table: 'memory_items', collection: 'items', keyColumns: ['id'], keyValues: [mutation.entityId],
        extraColumns: ['kind', 'label', 'lemma', 'source', 'verification_status'],
        extraValues: [
          requiredRecordString(value, 'kind'), requiredRecordString(value, 'label'), optionalRecordString(value, 'lemma'),
          requiredRecordString(value, 'source'), requiredRecordString(value, 'verificationStatus'),
        ],
        source: requiredRecordString(value, 'source'),
        verificationStatus: requiredRecordString(value, 'verificationStatus'),
        ...commonRevisioned(),
      };
    case 'sense':
      return {
        table: 'memory_senses', collection: 'senses', keyColumns: ['id'], keyValues: [mutation.entityId],
        extraColumns: ['item_id', 'prompt_ja', 'meaning_ja', 'sibling_group_id', 'source', 'verification_status'],
        extraValues: [
          requiredRecordString(value, 'itemId'), requiredRecordString(value, 'promptJa'), requiredRecordString(value, 'meaningJa'),
          requiredRecordString(value, 'siblingGroupId'), requiredRecordString(value, 'source'),
          requiredRecordString(value, 'verificationStatus'),
        ],
        source: requiredRecordString(value, 'source'),
        verificationStatus: requiredRecordString(value, 'verificationStatus'),
        ...commonRevisioned(),
      };
    case 'answer':
      return {
        table: 'memory_answers', collection: 'answers', keyColumns: ['id'], keyValues: [mutation.entityId],
        extraColumns: ['sense_id', 'display_form', 'citation_form', 'source', 'verification_status'],
        extraValues: [
          requiredRecordString(value, 'senseId'), requiredRecordString(value, 'displayForm'), requiredRecordString(value, 'citationForm'),
          requiredRecordString(value, 'source'), requiredRecordString(value, 'verificationStatus'),
        ],
        source: requiredRecordString(value, 'source'),
        verificationStatus: requiredRecordString(value, 'verificationStatus'),
        ...commonRevisioned(),
      };
    case 'example':
      return {
        table: 'memory_examples', collection: 'examples', keyColumns: ['id'], keyValues: [mutation.entityId],
        extraColumns: ['sense_id', 'answer_id', 'english', 'source', 'verification_status'],
        extraValues: [
          requiredRecordString(value, 'senseId'), optionalRecordString(value, 'answerId'), requiredRecordString(value, 'english'),
          requiredRecordString(value, 'source'), requiredRecordString(value, 'verificationStatus'),
        ],
        source: requiredRecordString(value, 'source'),
        verificationStatus: requiredRecordString(value, 'verificationStatus'),
        ...commonRevisioned(),
      };
    case 'exercise':
      return {
        table: 'memory_exercises', collection: 'exercises', keyColumns: ['id'], keyValues: [mutation.entityId],
        extraColumns: ['sense_id', 'answer_id', 'type', 'prompt', 'sibling_group_id', 'source', 'verification_status'],
        extraValues: [
          requiredRecordString(value, 'senseId'), optionalRecordString(value, 'answerId'), requiredRecordString(value, 'type'),
          requiredRecordString(value, 'prompt'), requiredRecordString(value, 'siblingGroupId'),
          requiredRecordString(value, 'source'), requiredRecordString(value, 'verificationStatus'),
        ],
        source: requiredRecordString(value, 'source'),
        verificationStatus: requiredRecordString(value, 'verificationStatus'),
        ...commonRevisioned(),
      };
    case 'set_member':
      return {
        table: 'memory_set_members', collection: 'setMembers', keyColumns: ['set_id', 'item_id'],
        keyValues: [requiredRecordString(value, 'setId'), requiredRecordString(value, 'itemId')],
        extraColumns: ['sort_order'], extraValues: [requiredRecordNumber(value, 'order')],
        createdAt: requiredRecordString(value, 'createdAt'), updatedAt: mutation.createdAt,
        deletedAt: optionalRecordString(value, 'deletedAt'),
      };
    case 'session':
      return {
        table: 'memory_sessions', collection: 'sessions', keyColumns: ['id'], keyValues: [mutation.entityId],
        extraColumns: ['status', 'completed_at'],
        extraValues: [requiredRecordString(value, 'status'), optionalRecordString(value, 'completedAt')],
        createdAt: requiredRecordString(value, 'createdAt'), updatedAt: requiredRecordString(value, 'updatedAt'),
        deletedAt: null,
      };
    case 'stat_preference':
      throw new MemoryValidationError('stat_preference does not use content storage');
    case 'attempt_void':
      throw new MemoryValidationError('attempt_void does not use content storage');
  }
}

function whereClause(storage: EntityStorage): string {
  return storage.keyColumns.map((column) => `${column} = ?`).join(' AND ');
}

async function loadStoredRecord(db: D1Database, userId: string, storage: EntityStorage): Promise<StoredRecordRow | null> {
  return db.prepare(
    `SELECT data_json, revision,
            ${storage.source === undefined ? 'NULL' : 'source'} AS source,
            ${storage.verificationStatus === undefined ? 'NULL' : 'verification_status'} AS verification_status,
            created_at
     FROM ${storage.table}
     WHERE user_id = ? AND ${whereClause(storage)}`,
  ).bind(userId, ...storage.keyValues).first<StoredRecordRow>();
}

function parseStoredRecord(row: StoredRecordRow | null): unknown {
  if (!row) return null;
  try {
    return JSON.parse(row.data_json) as unknown;
  } catch {
    throw new Error('Stored memory record is not valid JSON');
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function mutationHash(mutation: MemoryMutationInput): Promise<string> {
  return sha256Hex(JSON.stringify(mutation));
}

async function attemptHash(attempt: MemoryAttemptInput): Promise<string> {
  return sha256Hex(JSON.stringify(attempt));
}

async function loadStoredMutation(db: D1Database, userId: string, mutationId: string): Promise<StoredMutationRow | null> {
  return db.prepare(
    `SELECT request_hash, status, result_json
     FROM memory_mutations WHERE user_id = ? AND mutation_id = ?`,
  ).bind(userId, mutationId).first<StoredMutationRow>();
}

function parseConflictResult(resultJson: string): MemoryConflictOutput | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson) as unknown;
  } catch {
    throw new Error('Stored mutation result is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const conflict = (parsed as { conflict?: unknown }).conflict;
  if (typeof conflict !== 'object' || conflict === null) return undefined;
  return conflict as MemoryConflictOutput;
}

async function storeConflict(
  db: D1Database,
  userId: string,
  mutation: MemoryMutationInput,
  requestHash: string,
  serverRecord: unknown,
  now: string,
): Promise<MemoryConflictOutput> {
  const conflict: MemoryConflictOutput = {
    id: `conf_${crypto.randomUUID()}`,
    mutationId: mutation.mutationId,
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    entityKey: mutation.entityKey,
    localValue: mutation.payload,
    serverValue: serverRecord,
    ...(mutation.baseRevision === undefined ? {} : { baseRevision: mutation.baseRevision }),
    createdAt: now,
  };
  const resultJson = JSON.stringify({ status: 'conflict', conflict });
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO memory_sync_conflicts (
           user_id, conflict_id, mutation_id, client_id, entity_type, entity_id, entity_key,
           base_revision, local_record_json, server_record_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        userId, conflict.id, mutation.mutationId, mutation.clientId, mutation.entityType, mutation.entityId,
        mutation.entityKey, mutation.baseRevision ?? null, JSON.stringify(mutation.payload),
        serverRecord === null ? null : JSON.stringify(serverRecord), now,
      ),
      db.prepare(
        `INSERT INTO memory_mutations (
           user_id, mutation_id, client_id, entity_type, entity_key, request_hash,
           status, result_json, created_at, applied_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'conflict', ?, ?, ?)`,
      ).bind(
        userId, mutation.mutationId, mutation.clientId, mutation.entityType, mutation.entityKey,
        requestHash, resultJson, mutation.createdAt, now,
      ),
    ]);
  } catch (error) {
    // Identical offline retries can arrive concurrently. Reuse the first
    // durable receipt instead of turning a harmless UNIQUE race into a 500.
    const raced = await loadStoredMutation(db, userId, mutation.mutationId);
    if (!raced) throw error;
    if (raced.request_hash !== requestHash) {
      throw new MemoryValidationError('mutationId was reused with different data', 409);
    }
    const existingConflict = parseConflictResult(raced.result_json);
    if (raced.status !== 'conflict' || !existingConflict) throw error;
    return existingConflict;
  }
  return conflict;
}

async function recordAppliedMutation(
  db: D1Database,
  userId: string,
  mutation: MemoryMutationInput,
  requestHash: string,
  now: string,
): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO memory_mutations (
         user_id, mutation_id, client_id, entity_type, entity_key, request_hash,
         status, result_json, created_at, applied_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'applied', '{"status":"applied"}', ?, ?)`,
    ).bind(
      userId, mutation.mutationId, mutation.clientId, mutation.entityType, mutation.entityKey,
      requestHash, mutation.createdAt, now,
    ).run();
  } catch (error) {
    const raced = await loadStoredMutation(db, userId, mutation.mutationId);
    if (!raced || raced.request_hash !== requestHash || raced.status !== 'applied') throw error;
  }
}

function resultFromStoredMutation(receipt: StoredMutationRow, requestHash: string): ApplyMutationResult {
  if (receipt.request_hash !== requestHash) {
    throw new MemoryValidationError('mutationId was reused with different data', 409);
  }
  return receipt.status === 'conflict' ? { conflict: parseConflictResult(receipt.result_json) } : {};
}

async function activeRecordExists(db: D1Database, userId: string, table: string, id: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS found FROM ${table} WHERE user_id = ? AND id = ? AND deleted_at IS NULL`,
  ).bind(userId, id).first<{ found: number }>();
  return row !== null;
}

async function referencesAreValid(db: D1Database, userId: string, mutation: MemoryMutationInput): Promise<boolean> {
  if (mutation.operation === 'delete' || typeof mutation.payload.deletedAt === 'string') return true;
  const value = mutation.payload;
  switch (mutation.entityType) {
    case 'item':
    case 'set':
      return true;
    case 'sense':
      return activeRecordExists(db, userId, 'memory_items', requiredRecordString(value, 'itemId'));
    case 'answer':
      return activeRecordExists(db, userId, 'memory_senses', requiredRecordString(value, 'senseId'));
    case 'example': {
      const senseId = requiredRecordString(value, 'senseId');
      if (!await activeRecordExists(db, userId, 'memory_senses', senseId)) return false;
      const answerId = optionalRecordString(value, 'answerId');
      if (!answerId) return true;
      const answer = await db.prepare(
        `SELECT 1 AS found FROM memory_answers
         WHERE user_id = ? AND id = ? AND sense_id = ? AND deleted_at IS NULL`,
      ).bind(userId, answerId, senseId).first<{ found: number }>();
      return answer !== null;
    }
    case 'exercise': {
      const senseId = requiredRecordString(value, 'senseId');
      if (!await activeRecordExists(db, userId, 'memory_senses', senseId)) return false;
      const answerId = optionalRecordString(value, 'answerId');
      if (answerId) {
        const answer = await db.prepare(
          `SELECT 1 AS found FROM memory_answers
           WHERE user_id = ? AND id = ? AND sense_id = ? AND deleted_at IS NULL`,
        ).bind(userId, answerId, senseId).first<{ found: number }>();
        if (!answer) return false;
      }
      const accepted = value.acceptedAnswerIds;
      if (!Array.isArray(accepted) || accepted.length === 0) return true;
      const acceptedIds = accepted.map((entry) => String(entry));
      const placeholders = acceptedIds.map(() => '?').join(', ');
      const count = await db.prepare(
        `SELECT COUNT(*) AS count FROM memory_answers
         WHERE user_id = ? AND sense_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`,
      ).bind(userId, senseId, ...acceptedIds).first<{ count: number }>();
      return count?.count === new Set(acceptedIds).size;
    }
    case 'set_member': {
      const [setExists, itemExists] = await Promise.all([
        activeRecordExists(db, userId, 'memory_sets', requiredRecordString(value, 'setId')),
        activeRecordExists(db, userId, 'memory_items', requiredRecordString(value, 'itemId')),
      ]);
      return setExists && itemExists;
    }
    case 'session':
      return true;
    case 'stat_preference': {
      const targetType = requiredRecordString(value, 'targetType');
      const table = targetType === 'sense'
        ? 'memory_senses'
        : targetType === 'answer'
          ? 'memory_answers'
          : 'memory_exercises';
      return activeRecordExists(db, userId, table, requiredRecordString(value, 'targetId'));
    }
    case 'attempt_void':
      return true;
  }
}

function relationKeys(entityType: MemoryEntityType): readonly string[] {
  switch (entityType) {
    case 'sense': return ['itemId'];
    case 'answer': return ['senseId'];
    case 'example': return ['senseId', 'answerId'];
    case 'exercise': return ['senseId', 'answerId'];
    default: return [];
  }
}

function violatesImmutableFields(mutation: MemoryMutationInput, current: StoredRecordRow): boolean {
  const currentValue = parseStoredRecord(current);
  if (typeof currentValue !== 'object' || currentValue === null || Array.isArray(currentValue)) return true;
  const currentRecord = currentValue as Record<string, unknown>;
  if (currentRecord.createdAt !== mutation.payload.createdAt) return true;
  if (current.source !== null && current.source !== mutation.payload.source) return true;
  if (current.verification_status === 'verified' && mutation.payload.verificationStatus !== 'verified') return true;
  for (const key of relationKeys(mutation.entityType)) {
    if (currentRecord[key] !== mutation.payload[key]) return true;
  }
  return false;
}

function contentWriteStatement(
  db: D1Database,
  userId: string,
  mutation: MemoryMutationInput,
  storage: EntityStorage,
  now: string,
  insertMissing = false,
): D1PreparedStatement {
  const recordJson = JSON.stringify(mutation.payload);
  if (mutation.entityType === 'set_member' || mutation.entityType === 'session') {
    const columns = [
      'user_id', ...storage.keyColumns, ...storage.extraColumns, 'data_json', 'revision',
      'created_at', 'updated_at', 'server_updated_at', 'deleted_at', 'last_mutation_id',
    ];
    const values = [
      userId, ...storage.keyValues, ...storage.extraValues, recordJson, 1,
      storage.createdAt, storage.updatedAt, now, storage.deletedAt, mutation.mutationId,
    ];
    const assignments = [
      ...storage.extraColumns.map((column) => `${column} = excluded.${column}`),
      'data_json = excluded.data_json',
      `revision = ${storage.table}.revision + 1`,
      'updated_at = excluded.updated_at',
      'server_updated_at = excluded.server_updated_at',
      'deleted_at = excluded.deleted_at',
      'last_mutation_id = excluded.last_mutation_id',
    ];
    return db.prepare(
      `INSERT INTO ${storage.table} (${columns.join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})
       ON CONFLICT(user_id, ${storage.keyColumns.join(', ')}) DO UPDATE SET ${assignments.join(', ')}
       WHERE excluded.updated_at >= ${storage.table}.updated_at`,
    ).bind(...values);
  }

  if (mutation.operation === 'create' || insertMissing) {
    const columns = [
      'user_id', ...storage.keyColumns, ...storage.extraColumns, 'data_json', 'revision',
      'created_at', 'updated_at', 'server_updated_at', 'deleted_at', 'last_mutation_id',
    ];
    const values = [
      userId, ...storage.keyValues, ...storage.extraValues, recordJson, storage.incomingRevision,
      storage.createdAt, storage.updatedAt, now, storage.deletedAt, mutation.mutationId,
    ];
    return db.prepare(
      `INSERT INTO ${storage.table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    ).bind(...values);
  }

  const assignments = [
    ...storage.extraColumns.map((column) => `${column} = ?`),
    'data_json = ?', 'revision = ?', 'updated_at = ?', 'server_updated_at = ?',
    'deleted_at = ?', 'last_mutation_id = ?',
  ];
  return db.prepare(
    `UPDATE ${storage.table} SET ${assignments.join(', ')}
     WHERE user_id = ? AND ${whereClause(storage)} AND revision = ?`,
  ).bind(
    ...storage.extraValues, recordJson, storage.incomingRevision, storage.updatedAt, now,
    storage.deletedAt, mutation.mutationId, userId, ...storage.keyValues, mutation.baseRevision,
  );
}

function changeStatement(
  db: D1Database,
  userId: string,
  mutation: MemoryMutationInput,
  storage: EntityStorage,
  now: string,
): D1PreparedStatement {
  return db.prepare(
    `INSERT OR IGNORE INTO memory_sync_changes
       (user_id, collection_name, entity_type, entity_key, revision, record_json, changed_at)
     SELECT ?, ?, ?, ?, revision, ?, ?
     FROM ${storage.table}
     WHERE user_id = ? AND ${whereClause(storage)} AND last_mutation_id = ?`,
  ).bind(
    userId, storage.collection, mutation.entityType, mutation.entityKey, JSON.stringify(mutation.payload), now,
    userId, ...storage.keyValues, mutation.mutationId,
  );
}

function mutationReceiptStatement(
  db: D1Database,
  userId: string,
  mutation: MemoryMutationInput,
  requestHash: string,
  storage: EntityStorage,
  now: string,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO memory_mutations (
       user_id, mutation_id, client_id, entity_type, entity_key, request_hash,
       status, result_json, created_at, applied_at
     )
     SELECT ?, ?, ?, ?, ?, ?, 'applied', '{"status":"applied"}', ?, ?
     FROM ${storage.table}
     WHERE user_id = ? AND ${whereClause(storage)} AND last_mutation_id = ?`,
  ).bind(
    userId, mutation.mutationId, mutation.clientId, mutation.entityType, mutation.entityKey,
    requestHash, mutation.createdAt, now, userId, ...storage.keyValues, mutation.mutationId,
  );
}

function parseErrorTypes(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

function attemptToClient(row: AttemptRow, undoneAt?: string): Record<string, unknown> {
  return {
    attemptId: row.attempt_id,
    sessionId: row.session_id,
    clientId: row.client_id,
    itemId: row.item_id,
    senseId: row.sense_id,
    ...(row.answer_id === null ? {} : { answerId: row.answer_id }),
    ...(row.exercise_id === null ? {} : { exerciseId: row.exercise_id }),
    targetId: row.target_id,
    mode: row.mode,
    exerciseType: row.exercise_type,
    ...(row.user_answer === null ? {} : { userAnswer: row.user_answer }),
    ...(row.normalized_answer === null ? {} : { normalizedAnswer: row.normalized_answer }),
    assessment: row.assessment,
    errorTypes: parseErrorTypes(row.error_types_json),
    hintUsed: Boolean(row.hint_used),
    responseMs: row.response_ms,
    createdAt: row.created_at,
    syncedAt: row.server_received_at,
    ...(undoneAt === undefined ? {} : { undoneAt }),
  };
}

async function loadAttempt(db: D1Database, userId: string, attemptId: string): Promise<AttemptRow | null> {
  return db.prepare(
    `SELECT attempt_id, session_id, client_id, item_id, sense_id, answer_id, exercise_id,
            target_id, mode, exercise_type, user_answer, normalized_answer, assessment,
            error_types_json, hint_used, response_ms, created_at, server_received_at
     FROM memory_attempts WHERE user_id = ? AND attempt_id = ?`,
  ).bind(userId, attemptId).first<AttemptRow>();
}

function addAttemptStatTargets(targets: Map<string, AffectedStatTarget>, attempt: AttemptRow): void {
  if (attempt.exercise_id) {
    // A specified/context exercise evaluates only the selected expression and the
    // concrete exercise. It must not inflate the broader Sense score.
    addAffectedStatTarget(targets, 'answer', attempt.answer_id ?? undefined, attempt.mode);
    addAffectedStatTarget(targets, 'exercise', attempt.exercise_id, attempt.mode);
  } else {
    addAffectedStatTarget(targets, 'sense', attempt.sense_id, attempt.mode);
    // Ordinary output also records the expression actually produced, never its siblings.
    addAffectedStatTarget(targets, 'answer', attempt.answer_id ?? undefined, attempt.mode);
  }
}

async function applyAttemptVoid(
  db: D1Database,
  userId: string,
  mutation: MemoryMutationInput,
  requestHash: string,
  now: string,
  targets: Map<string, AffectedStatTarget>,
): Promise<ApplyMutationResult> {
  const attempt = await loadAttempt(db, userId, mutation.entityId);
  // The Attempt upload and its undo can be flushed by separate overlapping
  // requests. Leave the void pending instead of persisting a false conflict;
  // it will be accepted as soon as the append-only Attempt arrives.
  if (!attempt) return { deferred: true };
  const existingVoid = await db.prepare(
    `SELECT created_at FROM memory_attempt_voids WHERE user_id = ? AND attempt_id = ?`,
  ).bind(userId, attempt.attempt_id).first<{ created_at: string }>();
  if (existingVoid) {
    await recordAppliedMutation(db, userId, mutation, requestHash, now);
    addAttemptStatTargets(targets, attempt);
    return { affectedAttempt: attempt };
  }

  const undoneAt = requiredRecordString(mutation.payload, 'undoneAt');
  const recordJson = JSON.stringify(attemptToClient(attempt, undoneAt));
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO memory_attempt_voids (
           user_id, void_id, attempt_id, session_id, client_id, created_at, server_received_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(userId, mutation.mutationId, attempt.attempt_id, attempt.session_id, mutation.clientId, undoneAt, now),
      db.prepare(
        `INSERT OR IGNORE INTO memory_sync_changes
           (user_id, collection_name, entity_type, entity_key, revision, record_json, changed_at)
         VALUES (?, 'attempts', 'attempt', ?, 2, ?, ?)`,
      ).bind(userId, attempt.attempt_id, recordJson, now),
      db.prepare(
        `INSERT INTO memory_mutations (
           user_id, mutation_id, client_id, entity_type, entity_key, request_hash,
           status, result_json, created_at, applied_at
         ) VALUES (?, ?, ?, 'attempt_void', ?, ?, 'applied', '{"status":"applied"}', ?, ?)`,
      ).bind(
        userId, mutation.mutationId, mutation.clientId, mutation.entityKey, requestHash, mutation.createdAt, now,
      ),
    ]);
  } catch (error) {
    const racedReceipt = await loadStoredMutation(db, userId, mutation.mutationId);
    if (racedReceipt) return resultFromStoredMutation(racedReceipt, requestHash);
    const racedVoid = await db.prepare(
      `SELECT created_at FROM memory_attempt_voids WHERE user_id = ? AND attempt_id = ?`,
    ).bind(userId, attempt.attempt_id).first<{ created_at: string }>();
    if (!racedVoid) throw error;
    await recordAppliedMutation(db, userId, mutation, requestHash, now);
  }
  addAttemptStatTargets(targets, attempt);
  return { affectedAttempt: attempt };
}

async function applyStatPreference(
  db: D1Database,
  userId: string,
  mutation: MemoryMutationInput,
  requestHash: string,
  now: string,
): Promise<ApplyMutationResult> {
  const targetType = requiredRecordString(mutation.payload, 'targetType') as 'sense' | 'answer' | 'exercise';
  const targetId = requiredRecordString(mutation.payload, 'targetId');
  const mode = requiredRecordString(mutation.payload, 'mode') as MemoryMode;
  const manualWeak = mutation.payload.manualWeak === true;
  const updatedAt = requiredRecordString(mutation.payload, 'updatedAt');
  const current = await getStoredMemoryStat(db, userId, targetType, targetId, mode);

  if (!await referencesAreValid(db, userId, mutation)) {
    return { conflict: await storeConflict(db, userId, mutation, requestHash, current, now) };
  }
  if ((mutation.baseRevision ?? -1) !== (current?.revision ?? 0)) {
    return { conflict: await storeConflict(db, userId, mutation, requestHash, current, now) };
  }

  const derived = await deriveMemoryStat(db, userId, targetType, targetId, mode, updatedAt, manualWeak);
  if (!derived) throw new Error('Could not derive a manual memory stat');
  if (derived.currentRevision !== (mutation.baseRevision ?? -1)) {
    const latest = await getStoredMemoryStat(db, userId, targetType, targetId, mode);
    return { conflict: await storeConflict(db, userId, mutation, requestHash, latest, now) };
  }
  if (derived.unchanged) {
    let result: D1Result;
    try {
      result = await db.prepare(
        `INSERT INTO memory_mutations (
           user_id, mutation_id, client_id, entity_type, entity_key, request_hash,
           status, result_json, created_at, applied_at
         )
         SELECT ?, ?, ?, 'stat_preference', ?, ?, 'applied', '{"status":"applied"}', ?, ?
         FROM memory_stats WHERE user_id = ? AND id = ? AND revision = ?`,
      ).bind(
        userId, mutation.mutationId, mutation.clientId, mutation.entityKey, requestHash,
        mutation.createdAt, now, userId, derived.record.id, derived.currentRevision,
      ).run();
    } catch (error) {
      const racedReceipt = await loadStoredMutation(db, userId, mutation.mutationId);
      if (racedReceipt) return resultFromStoredMutation(racedReceipt, requestHash);
      throw error;
    }
    if ((result.meta.changes ?? 0) === 1) return {};
    const racedReceipt = await loadStoredMutation(db, userId, mutation.mutationId);
    if (racedReceipt) return resultFromStoredMutation(racedReceipt, requestHash);
    const latest = await getStoredMemoryStat(db, userId, targetType, targetId, mode);
    return { conflict: await storeConflict(db, userId, mutation, requestHash, latest, now) };
  }

  const receipt = db.prepare(
    `INSERT INTO memory_mutations (
       user_id, mutation_id, client_id, entity_type, entity_key, request_hash,
       status, result_json, created_at, applied_at
     )
     SELECT ?, ?, ?, 'stat_preference', ?, ?, 'applied', '{"status":"applied"}', ?, ?
     FROM memory_stats
     WHERE user_id = ? AND id = ? AND revision = ? AND last_mutation_id = ?`,
  ).bind(
    userId, mutation.mutationId, mutation.clientId, mutation.entityKey, requestHash,
    mutation.createdAt, now, userId, derived.record.id, derived.record.revision, mutation.mutationId,
  );

  try {
    const results = await db.batch([
      memoryStatWriteStatement(db, userId, derived, mutation.mutationId),
      memoryStatChangeStatement(db, userId, derived.record, mutation.mutationId, now),
      receipt,
    ]);
    if ((results[0]?.meta.changes ?? 0) === 1) return {};
  } catch (error) {
    const racedReceipt = await loadStoredMutation(db, userId, mutation.mutationId);
    if (racedReceipt) return resultFromStoredMutation(racedReceipt, requestHash);
    const latest = await getStoredMemoryStat(db, userId, targetType, targetId, mode);
    if (latest) return { conflict: await storeConflict(db, userId, mutation, requestHash, latest, now) };
    throw error;
  }

  const racedReceipt = await loadStoredMutation(db, userId, mutation.mutationId);
  if (racedReceipt) return resultFromStoredMutation(racedReceipt, requestHash);
  const latest = await getStoredMemoryStat(db, userId, targetType, targetId, mode);
  return { conflict: await storeConflict(db, userId, mutation, requestHash, latest, now) };
}

async function applyMutation(
  env: Env,
  userId: string,
  mutation: MemoryMutationInput,
  now: string,
  targets: Map<string, AffectedStatTarget>,
): Promise<ApplyMutationResult> {
  const requestHash = await mutationHash(mutation);
  const receipt = await loadStoredMutation(env.DB, userId, mutation.mutationId);
  if (receipt) {
    return resultFromStoredMutation(receipt, requestHash);
  }
  if (mutation.entityType === 'attempt_void') {
    return applyAttemptVoid(env.DB, userId, mutation, requestHash, now, targets);
  }
  if (mutation.entityType === 'stat_preference') {
    return applyStatPreference(env.DB, userId, mutation, requestHash, now);
  }

  const storage = storageFor(mutation);
  const current = await loadStoredRecord(env.DB, userId, storage);
  const revisionedEntity = ['item', 'sense', 'answer', 'example', 'exercise', 'set'].includes(mutation.entityType);
  const restoreUpsert = revisionedEntity && mutation.operation === 'upsert';
  const restoringMissingRecord = restoreUpsert && current === null;
  const restoringMissingTombstone = restoringMissingRecord
    && typeof mutation.payload.deletedAt === 'string';

  if (restoringMissingTombstone) {
    // The backup observed a deletion that an empty/new cloud has already
    // satisfied. Persist only the idempotency receipt; no conflict or row is
    // necessary.
    await recordAppliedMutation(env.DB, userId, mutation, requestHash, now);
    return {};
  }
  if (mutation.operation === 'create' ? current !== null
    : mutation.entityType !== 'set_member'
      && mutation.entityType !== 'session'
      && current === null
      && !restoreUpsert) {
    return { conflict: await storeConflict(env.DB, userId, mutation, requestHash, parseStoredRecord(current), now) };
  }
  if (current && storage.incomingRevision !== undefined) {
    if (current.revision !== mutation.baseRevision || violatesImmutableFields(mutation, current)) {
      return { conflict: await storeConflict(env.DB, userId, mutation, requestHash, parseStoredRecord(current), now) };
    }
  }
  if (mutation.operation === 'create' && storage.source === 'ai' && storage.verificationStatus !== 'unverified_ai') {
    return { conflict: await storeConflict(env.DB, userId, mutation, requestHash, null, now) };
  }
  if (!await referencesAreValid(env.DB, userId, mutation)) {
    return { conflict: await storeConflict(env.DB, userId, mutation, requestHash, parseStoredRecord(current), now) };
  }

  let results: D1Result[];
  try {
    results = await env.DB.batch([
      contentWriteStatement(env.DB, userId, mutation, storage, now, restoringMissingRecord),
      changeStatement(env.DB, userId, mutation, storage, now),
      mutationReceiptStatement(env.DB, userId, mutation, requestHash, storage, now),
    ]);
  } catch (error) {
    const racedReceipt = await loadStoredMutation(env.DB, userId, mutation.mutationId);
    if (racedReceipt) return resultFromStoredMutation(racedReceipt, requestHash);
    const latest = await loadStoredRecord(env.DB, userId, storage);
    if (latest) return { conflict: await storeConflict(env.DB, userId, mutation, requestHash, parseStoredRecord(latest), now) };
    throw error;
  }
  if ((results[0]?.meta.changes ?? 0) !== 1) {
    const racedReceipt = await loadStoredMutation(env.DB, userId, mutation.mutationId);
    if (racedReceipt) return resultFromStoredMutation(racedReceipt, requestHash);
    const latest = await loadStoredRecord(env.DB, userId, storage);
    return { conflict: await storeConflict(env.DB, userId, mutation, requestHash, parseStoredRecord(latest), now) };
  }
  return {};
}

async function assertAttemptIdsReusable(db: D1Database, userId: string, attempts: MemoryAttemptInput[]): Promise<void> {
  for (const attempt of attempts) {
    const existing = await db.prepare(
      `SELECT payload_hash FROM memory_attempts WHERE user_id = ? AND attempt_id = ?`,
    ).bind(userId, attempt.attemptId).first<{ payload_hash: string }>();
    if (existing && existing.payload_hash !== await attemptHash(attempt)) {
      throw new MemoryValidationError('attemptId was reused with different data', 409);
    }
  }
}

async function attemptReferencesAreValid(db: D1Database, userId: string, attempt: MemoryAttemptInput): Promise<boolean> {
  const row = await db.prepare(
    `SELECT
       EXISTS(SELECT 1 FROM memory_sessions s WHERE s.user_id = ? AND s.id = ? AND s.deleted_at IS NULL) AS session_ok,
       EXISTS(SELECT 1 FROM memory_senses s WHERE s.user_id = ? AND s.id = ? AND s.item_id = ? AND s.deleted_at IS NULL) AS sense_ok,
       CASE WHEN ? IS NULL THEN 1 ELSE EXISTS(
         SELECT 1 FROM memory_answers a WHERE a.user_id = ? AND a.id = ? AND a.sense_id = ? AND a.deleted_at IS NULL
       ) END AS answer_ok,
       CASE WHEN ? IS NULL THEN 1 ELSE EXISTS(
         SELECT 1 FROM memory_exercises e WHERE e.user_id = ? AND e.id = ? AND e.sense_id = ? AND e.deleted_at IS NULL
       ) END AS exercise_ok`,
  ).bind(
    userId, attempt.sessionId,
    userId, attempt.senseId, attempt.itemId,
    attempt.answerId ?? null, userId, attempt.answerId ?? null, attempt.senseId,
    attempt.exerciseId ?? null, userId, attempt.exerciseId ?? null, attempt.senseId,
  ).first<{ session_ok: number; sense_ok: number; answer_ok: number; exercise_ok: number }>();
  return Boolean(row?.session_ok && row.sense_ok && row.answer_ok && row.exercise_ok);
}

function inputAttemptToRow(attempt: MemoryAttemptInput, serverReceivedAt: string): AttemptRow {
  return {
    attempt_id: attempt.attemptId,
    session_id: attempt.sessionId,
    client_id: attempt.clientId,
    item_id: attempt.itemId,
    sense_id: attempt.senseId,
    answer_id: attempt.answerId ?? null,
    exercise_id: attempt.exerciseId ?? null,
    target_id: attempt.targetId,
    mode: attempt.mode,
    exercise_type: attempt.exerciseType,
    user_answer: attempt.userAnswer ?? null,
    normalized_answer: attempt.normalizedAnswer ?? null,
    assessment: attempt.assessment,
    error_types_json: JSON.stringify(attempt.errorTypes),
    hint_used: attempt.hintUsed ? 1 : 0,
    response_ms: attempt.responseMs,
    created_at: attempt.createdAt,
    server_received_at: serverReceivedAt,
  };
}

async function applyAttempt(
  db: D1Database,
  userId: string,
  attempt: MemoryAttemptInput,
  now: string,
  targets: Map<string, AffectedStatTarget>,
): Promise<boolean> {
  const payloadHash = await attemptHash(attempt);
  const existing = await db.prepare(
    `SELECT payload_hash FROM memory_attempts WHERE user_id = ? AND attempt_id = ?`,
  ).bind(userId, attempt.attemptId).first<{ payload_hash: string }>();
  if (existing) {
    if (existing.payload_hash !== payloadHash) throw new MemoryValidationError('attemptId was reused with different data', 409);
    const row = await loadAttempt(db, userId, attempt.attemptId);
    if (row) addAttemptStatTargets(targets, row);
    return true;
  }
  if (!await attemptReferencesAreValid(db, userId, attempt)) return false;

  const row = inputAttemptToRow(attempt, now);
  const recordJson = JSON.stringify(attemptToClient(row));
  const results = await db.batch([
    db.prepare(
      `INSERT INTO memory_attempts (
         user_id, attempt_id, session_id, client_id, item_id, sense_id, answer_id, exercise_id,
         target_id, mode, exercise_type, user_answer, normalized_answer, assessment,
         error_types_json, hint_used, response_ms, created_at, server_received_at, payload_hash
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, attempt_id) DO NOTHING`,
    ).bind(
      userId, row.attempt_id, row.session_id, row.client_id, row.item_id, row.sense_id,
      row.answer_id, row.exercise_id, row.target_id, row.mode, row.exercise_type,
      row.user_answer, row.normalized_answer, row.assessment, row.error_types_json,
      row.hint_used, row.response_ms, row.created_at, row.server_received_at, payloadHash,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO memory_sync_changes
         (user_id, collection_name, entity_type, entity_key, revision, record_json, changed_at)
       SELECT ?, 'attempts', 'attempt', ?, 1, ?, ?
       FROM memory_attempts WHERE user_id = ? AND attempt_id = ? AND payload_hash = ?`,
    ).bind(userId, row.attempt_id, recordJson, now, userId, row.attempt_id, payloadHash),
  ]);
  if ((results[0]?.meta.changes ?? 0) === 0) {
    const raced = await db.prepare(
      `SELECT payload_hash FROM memory_attempts WHERE user_id = ? AND attempt_id = ?`,
    ).bind(userId, attempt.attemptId).first<{ payload_hash: string }>();
    if (!raced || raced.payload_hash !== payloadHash) throw new MemoryValidationError('attemptId conflict', 409);
  }
  addAttemptStatTargets(targets, row);
  return true;
}

async function pullChanges(
  db: D1Database,
  userId: string,
  cursor: number,
): Promise<{ changes: MemoryRemoteChanges; cursor: number; hasMore: boolean }> {
  const result = await db.prepare(
    `SELECT seq, collection_name, record_json
     FROM memory_sync_changes
     WHERE user_id = ? AND seq > ?
     ORDER BY seq ASC LIMIT ?`,
  ).bind(userId, cursor, PULL_LIMIT + 1).all<{ seq: number; collection_name: keyof MemoryRemoteChanges; record_json: string }>();
  const rows = result.results.slice(0, PULL_LIMIT);
  const changes: MemoryRemoteChanges = {};
  for (const row of rows) {
    let record: unknown;
    try {
      record = JSON.parse(row.record_json) as unknown;
    } catch {
      throw new Error('Stored memory change is not valid JSON');
    }
    const collection = row.collection_name;
    const list = changes[collection];
    if (list) list.push(record);
    else changes[collection] = [record];
  }
  return {
    changes,
    cursor: rows.length === 0 ? cursor : rows[rows.length - 1].seq,
    hasMore: result.results.length > PULL_LIMIT,
  };
}

function mutationDependencyKeys(mutation: MemoryMutationInput): string[] {
  const value = mutation.payload;
  const stringField = (key: string) => typeof value[key] === 'string' ? String(value[key]) : undefined;
  switch (mutation.entityType) {
    case 'sense': {
      const itemId = stringField('itemId');
      return itemId ? [`item:${itemId}`] : [];
    }
    case 'answer': {
      const senseId = stringField('senseId');
      return senseId ? [`sense:${senseId}`] : [];
    }
    case 'example':
    case 'exercise': {
      const keys: string[] = [];
      const senseId = stringField('senseId');
      const answerId = stringField('answerId');
      if (senseId) keys.push(`sense:${senseId}`);
      if (answerId) keys.push(`answer:${answerId}`);
      if (mutation.entityType === 'exercise' && Array.isArray(value.acceptedAnswerIds)) {
        for (const id of value.acceptedAnswerIds) if (typeof id === 'string') keys.push(`answer:${id}`);
      }
      return [...new Set(keys)];
    }
    case 'set_member': {
      const setId = stringField('setId');
      const itemId = stringField('itemId');
      return [...(setId ? [`set:${setId}`] : []), ...(itemId ? [`item:${itemId}`] : [])];
    }
    case 'stat_preference': {
      const targetType = stringField('targetType');
      const targetId = stringField('targetId');
      return targetType && targetId ? [`${targetType}:${targetId}`] : [];
    }
    default:
      return [];
  }
}

function isMutationDeletion(mutation: MemoryMutationInput): boolean {
  return mutation.operation === 'delete' || typeof mutation.payload.deletedAt === 'string';
}

/** Stable topological order, with each entity's input order kept intact. */
function orderMutations(mutations: MemoryMutationInput[]): MemoryMutationInput[] {
  const byEntity = new Map<string, number[]>();
  mutations.forEach((mutation, index) => {
    const list = byEntity.get(mutation.entityKey);
    if (list) list.push(index);
    else byEntity.set(mutation.entityKey, [index]);
  });
  const outgoing = mutations.map(() => new Set<number>());
  const incoming = mutations.map(() => 0);
  const addEdge = (from: number, to: number) => {
    if (from === to || outgoing[from].has(to)) return;
    outgoing[from].add(to);
    incoming[to] += 1;
  };
  for (const indices of byEntity.values()) {
    for (let index = 1; index < indices.length; index += 1) addEdge(indices[index - 1], indices[index]);
  }
  mutations.forEach((mutation, index) => {
    for (const dependencyKey of mutationDependencyKeys(mutation)) {
      for (const dependencyIndex of byEntity.get(dependencyKey) ?? []) {
        const dependency = mutations[dependencyIndex];
        if (isMutationDeletion(mutation) && isMutationDeletion(dependency)) addEdge(index, dependencyIndex);
        else if (!isMutationDeletion(mutation) && !isMutationDeletion(dependency)) addEdge(dependencyIndex, index);
      }
    }
  });
  const available: number[] = [];
  incoming.forEach((count, index) => { if (count === 0) available.push(index); });
  const result: MemoryMutationInput[] = [];
  const emitted = new Set<number>();
  while (available.length > 0) {
    available.sort((left, right) => left - right);
    const index = available.shift()!;
    emitted.add(index);
    result.push(mutations[index]);
    for (const next of outgoing[index]) {
      incoming[next] -= 1;
      if (incoming[next] === 0) available.push(next);
    }
  }
  mutations.forEach((mutation, index) => { if (!emitted.has(index)) result.push(mutation); });
  return result;
}

export async function syncMemoryData(env: Env, userId: string, input: MemorySyncInput): Promise<MemorySyncOutput> {
  await assertAttemptIdsReusable(env.DB, userId, input.attempts);
  const serverTime = new Date().toISOString();
  const acceptedMutationIds: string[] = [];
  const acceptedAttemptIds: string[] = [];
  const conflicts: MemoryConflictOutput[] = [];
  const affectedTargets = new Map<string, AffectedStatTarget>();

  const ordered = orderMutations(input.mutations);
  const normalMutations = ordered.filter((mutation) => mutation.entityType !== 'attempt_void');
  const voidMutations = ordered.filter((mutation) => mutation.entityType === 'attempt_void');
  const blockedEntityKeys = new Set<string>();

  const applyOrderedMutation = async (mutation: MemoryMutationInput) => {
    const dependencyKeys = mutationDependencyKeys(mutation);
    if (blockedEntityKeys.has(mutation.entityKey) || dependencyKeys.some((key) => blockedEntityKeys.has(key))) {
      // Keep the dependent mutation pending until its parent conflict is
      // explicitly resolved. For tombstones the dependency direction reverses:
      // a failed child deletion must also stop the parent tombstone.
      blockedEntityKeys.add(mutation.entityKey);
      if (isMutationDeletion(mutation)) {
        for (const dependencyKey of dependencyKeys) blockedEntityKeys.add(dependencyKey);
      }
      return;
    }
    const result = await applyMutation(env, userId, mutation, serverTime, affectedTargets);
    if (result.deferred) return;
    acceptedMutationIds.push(mutation.mutationId);
    if (result.conflict) {
      conflicts.push(result.conflict);
      // Do not let a later edit or dependent child leapfrog a stale base.
      blockedEntityKeys.add(mutation.entityKey);
      if (isMutationDeletion(mutation)) {
        for (const dependencyKey of dependencyKeys) blockedEntityKeys.add(dependencyKey);
      }
    }
  };

  // Content/session parents must exist before attempts. A void is deliberately
  // last so an undo racing its first upload can append then invalidate safely in
  // the same request.
  for (const mutation of normalMutations) await applyOrderedMutation(mutation);
  for (const attempt of input.attempts) {
    if (await applyAttempt(env.DB, userId, attempt, serverTime, affectedTargets)) {
      acceptedAttemptIds.push(attempt.attemptId);
    }
  }
  for (const mutation of voidMutations) await applyOrderedMutation(mutation);
  await recomputeAffectedStats(env.DB, userId, affectedTargets, serverTime);
  const pulled = await pullChanges(env.DB, userId, input.cursor);

  return {
    schemaVersion: 1,
    serverTime,
    cursor: String(pulled.cursor),
    acceptedMutationIds,
    acceptedAttemptIds,
    conflicts,
    changes: pulled.changes,
    ...(pulled.hasMore ? { hasMore: true } : {}),
  };
}
