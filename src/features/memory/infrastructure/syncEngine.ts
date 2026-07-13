import { apiSyncMemory, type MemoryApiError } from './api';
import { MemoryRepository, type LocalMemoryAttempt, type MemoryPendingMutation } from './repositories';

export type MemorySyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error';

export interface MemorySyncResult {
  status: MemorySyncStatus;
  uploadedMutations: number;
  uploadedAttempts: number;
  conflicts: number;
  hasMore: boolean;
}

const activeSyncs = new WeakMap<MemoryRepository, Promise<MemorySyncResult>>();

// A request can fan out into several D1 statements per mutation/attempt (including
// stat recomputation). Keep the upload small and let flush iterate; the UI's
// twenty-answer trigger remains unchanged.
const MUTATION_UPLOAD_LIMIT = 5;
const ATTEMPT_UPLOAD_LIMIT = 2;
const INITIAL_PULL_ROUNDS = 10;

interface MemorySyncRoundResult extends MemorySyncResult {
  remoteHasMore: boolean;
  localBatchFull: boolean;
}

function mutationForUpload(mutation: MemoryPendingMutation): Omit<MemoryPendingMutation, 'localSequence'> {
  const copy = { ...mutation };
  delete copy.localSequence;
  return copy;
}

function attemptForUpload(attempt: LocalMemoryAttempt): LocalMemoryAttempt {
  const copy = { ...attempt };
  // These are local receipt/tombstone fields, never part of an appended Attempt.
  delete copy.syncedAt;
  delete copy.undoneAt;
  return copy;
}

async function performSyncRound(repository: MemoryRepository): Promise<MemorySyncRoundResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      status: 'offline', uploadedMutations: 0, uploadedAttempts: 0, conflicts: 0,
      hasMore: false, remoteHasMore: false, localBatchFull: false,
    };
  }

  const [deviceClientId, cursor, mutationCandidates, attemptCandidates] = await Promise.all([
    repository.clientId(),
    repository.syncCursor(),
    repository.syncablePendingMutations(MUTATION_UPLOAD_LIMIT + 1),
    repository.unsyncedAttempts(50),
  ]);
  let requestClientId = deviceClientId;
  let mutations: MemoryPendingMutation[] = [];
  let attempts: LocalMemoryAttempt[] = [];
  if (mutationCandidates.length > 0) {
    // A legacy username database can be merged into an already-used user-id
    // database. Keep each request single-client (the API verifies this) and only
    // take a contiguous prefix so dependency ordering is never skipped.
    requestClientId = mutationCandidates[0].clientId;
    const voidOnly = mutationCandidates[0].entityType === 'attempt_void';
    for (const mutation of mutationCandidates) {
      if (mutation.clientId !== requestClientId || mutations.length >= MUTATION_UPLOAD_LIMIT) break;
      if (voidOnly && mutations.length >= 1) break;
      if (!voidOnly && mutation.entityType === 'attempt_void') break;
      mutations.push(mutation);
    }
  } else {
    let sameClient = attemptCandidates.filter((attempt) => attempt.clientId === requestClientId);
    if (sameClient.length === 0 && attemptCandidates.length > 0) {
      requestClientId = attemptCandidates[0].clientId;
      sameClient = attemptCandidates.filter((attempt) => attempt.clientId === requestClientId);
    }
    attempts = sameClient.slice(0, ATTEMPT_UPLOAD_LIMIT);
  }

  try {
    const response = await apiSyncMemory({
      schemaVersion: 1,
      clientId: requestClientId,
      cursor,
      mutations: mutations.map(mutationForUpload),
      attempts: attempts.map(attemptForUpload),
    });
    await repository.commitSyncResponse({
      ...response,
      sentAttemptIds: attempts.map((attempt) => attempt.attemptId),
    });
    const remoteHasMore = response.hasMore === true;
    const localBatchFull = mutationCandidates.length > mutations.length
      || attemptCandidates.length > attempts.length
      || mutations.length === MUTATION_UPLOAD_LIMIT
      || attempts.length === ATTEMPT_UPLOAD_LIMIT;
    return {
      status: response.conflicts.length > 0 ? 'conflict' : 'synced',
      uploadedMutations: response.acceptedMutationIds.length,
      uploadedAttempts: response.acceptedAttemptIds.length,
      conflicts: response.conflicts.length,
      hasMore: remoteHasMore || localBatchFull,
      remoteHasMore,
      localBatchFull,
    };
  } catch (caught) {
    const error = caught as MemoryApiError;
    return {
      status: error.isNetworkError ? 'offline' : error.status === 409 ? 'conflict' : 'error',
      uploadedMutations: 0,
      uploadedAttempts: 0,
      conflicts: 0,
      hasMore: false,
      remoteHasMore: false,
      localBatchFull: false,
    };
  }
}

function mergeStatus(current: MemorySyncStatus, next: MemorySyncStatus): MemorySyncStatus {
  if (next === 'offline' || next === 'error') return next;
  if (current === 'conflict' || next === 'conflict') return 'conflict';
  return next;
}

async function performSync(repository: MemoryRepository): Promise<MemorySyncResult> {
  let aggregate: MemorySyncResult = {
    status: 'idle', uploadedMutations: 0, uploadedAttempts: 0, conflicts: 0, hasMore: false,
  };
  let lastRound: MemorySyncRoundResult | undefined;
  // A normal first sync must drain server pagination; otherwise a fresh device
  // would stop after the first 500 change rows until another lifecycle event.
  for (let round = 0; round < INITIAL_PULL_ROUNDS; round += 1) {
    lastRound = await performSyncRound(repository);
    aggregate = {
      status: mergeStatus(aggregate.status, lastRound.status),
      uploadedMutations: aggregate.uploadedMutations + lastRound.uploadedMutations,
      uploadedAttempts: aggregate.uploadedAttempts + lastRound.uploadedAttempts,
      conflicts: aggregate.conflicts + lastRound.conflicts,
      hasMore: lastRound.hasMore,
    };
    if (lastRound.status === 'offline' || lastRound.status === 'error' || !lastRound.remoteHasMore) break;
  }
  if (lastRound?.remoteHasMore) aggregate.hasMore = true;
  return aggregate;
}

/** Serializes sync per repository so visibility/online/answer thresholds cannot race. */
export function syncMemory(repository: MemoryRepository): Promise<MemorySyncResult> {
  const current = activeSyncs.get(repository);
  if (current) return current;
  const running = performSync(repository).finally(() => activeSyncs.delete(repository));
  activeSyncs.set(repository, running);
  return running;
}

export async function flushMemorySync(repository: MemoryRepository, maximumRounds = 100): Promise<MemorySyncResult> {
  let aggregate: MemorySyncResult = {
    status: 'idle',
    uploadedMutations: 0,
    uploadedAttempts: 0,
    conflicts: 0,
    hasMore: false,
  };
  for (let round = 0; round < maximumRounds; round += 1) {
    const result = await syncMemory(repository);
    aggregate = {
      status: mergeStatus(aggregate.status, result.status),
      uploadedMutations: aggregate.uploadedMutations + result.uploadedMutations,
      uploadedAttempts: aggregate.uploadedAttempts + result.uploadedAttempts,
      conflicts: aggregate.conflicts + result.conflicts,
      hasMore: result.hasMore,
    };
    if (result.status === 'offline' || result.status === 'error' || !result.hasMore) break;
  }
  return aggregate;
}
