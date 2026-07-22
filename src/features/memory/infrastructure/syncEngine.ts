import { apiSyncMemory } from './api';
import { MemoryRepository, type LocalMemoryAttempt, type MemoryPendingMutation } from './repositories';
import {
  classifyMemorySyncError,
  logUnexpectedMemorySyncError,
  type MemorySyncErrorDiagnostic,
  type MemorySyncErrorKind,
  type MemorySyncRetryPolicy,
} from './syncError';

export type MemorySyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error';
export type MemorySyncTerminationReason =
  | 'queue-drained'
  | 'local-batch-pending'
  | 'remote-page-limit'
  | 'flush-round-limit'
  | 'failure';

export interface MemorySyncResult {
  status: MemorySyncStatus;
  uploadedMutations: number;
  uploadedAttempts: number;
  conflicts: number;
  hasMore: boolean;
  rounds?: number;
  terminationReason?: MemorySyncTerminationReason;
  limitReached?: boolean;
  remainingMutationsAtLeast?: number;
  remainingAttemptsAtLeast?: number;
  errorMessage?: string;
  errorKind?: MemorySyncErrorKind;
  retryable?: boolean;
  retryPolicy?: MemorySyncRetryPolicy;
  retryAfterMs?: number;
  diagnostic?: MemorySyncErrorDiagnostic;
}

export interface MemorySyncOptions {
  /** User-initiated sync bypasses an automatic retry cooldown. */
  force?: boolean;
  /** Test seams for deterministic cooldown tests. */
  now?: () => number;
  random?: () => number;
}

interface MemorySyncRetryState {
  failures: number;
  retryAt: number;
  lastFailure: MemorySyncResult;
}

const activeSyncs = new WeakMap<MemoryRepository, Promise<MemorySyncResult>>();
const retryStates = new WeakMap<MemoryRepository, MemorySyncRetryState>();

// One mutation can fan out into several D1 statements, including stat
// recomputation. Keep each request deliberately small and expose the remaining
// queue state instead of pretending a capped batch is fully synchronized.
export const MEMORY_MUTATION_UPLOAD_LIMIT = 5;
export const MEMORY_ATTEMPT_UPLOAD_LIMIT = 2;
export const MEMORY_INITIAL_PULL_ROUNDS = 10;
export const MEMORY_FLUSH_MAXIMUM_ROUNDS = 100;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;
const RETRY_JITTER_MIN = 0.75;
const RETRY_JITTER_SPAN = 0.5;

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

function navigatorOnline(): boolean | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.onLine;
}

export function memorySyncBackoffDelay(failures: number, randomValue = Math.random()): number {
  const exponent = Math.max(0, Math.min(10, failures - 1));
  const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** exponent));
  const normalizedRandom = Number.isFinite(randomValue) ? Math.min(1, Math.max(0, randomValue)) : 0.5;
  return Math.round(base * (RETRY_JITTER_MIN + normalizedRandom * RETRY_JITTER_SPAN));
}

function shouldBackoff(result: MemorySyncResult): boolean {
  return result.retryable === true
    && (result.retryPolicy === 'backoff'
      || result.retryPolicy === 'retry-soon'
      || result.retryPolicy === 'when-online');
}

function failedRound(error: unknown): MemorySyncRoundResult {
  const failure = classifyMemorySyncError(error, { navigatorOnline: navigatorOnline() });
  logUnexpectedMemorySyncError(failure, error);
  return {
    status: failure.syncStatus,
    uploadedMutations: 0,
    uploadedAttempts: 0,
    conflicts: 0,
    hasMore: false,
    rounds: 1,
    terminationReason: 'failure',
    remoteHasMore: false,
    localBatchFull: false,
    remainingMutationsAtLeast: 0,
    remainingAttemptsAtLeast: 0,
    errorMessage: failure.userMessage,
    errorKind: failure.kind,
    retryable: failure.retryable,
    retryPolicy: failure.retryPolicy,
    diagnostic: failure.diagnostic,
  };
}

async function performSyncRound(repository: MemoryRepository): Promise<MemorySyncRoundResult> {
  try {
    const [deviceClientId, cursor, mutationCandidates, attemptCandidates] = await Promise.all([
      repository.clientId(),
      repository.syncCursor(),
      repository.syncablePendingMutations(MEMORY_MUTATION_UPLOAD_LIMIT + 1),
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
        if (mutation.clientId !== requestClientId || mutations.length >= MEMORY_MUTATION_UPLOAD_LIMIT) break;
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
      attempts = sameClient.slice(0, MEMORY_ATTEMPT_UPLOAD_LIMIT);
    }

    // navigator.onLine is advisory only. Safari can report false while a request
    // is already viable, and true while the network has no route. The request is
    // the source of truth and its classified failure decides the UI state.
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
    const remainingMutationsAtLeast = Math.max(0, mutationCandidates.length - mutations.length);
    const remainingAttemptsAtLeast = Math.max(0, attemptCandidates.length - attempts.length);
    const localBatchFull = remainingMutationsAtLeast > 0
      || remainingAttemptsAtLeast > 0
      || mutations.length === MEMORY_MUTATION_UPLOAD_LIMIT
      || attempts.length === MEMORY_ATTEMPT_UPLOAD_LIMIT;
    return {
      status: response.conflicts.length > 0 ? 'conflict' : 'synced',
      uploadedMutations: response.acceptedMutationIds.length,
      uploadedAttempts: response.acceptedAttemptIds.length,
      conflicts: response.conflicts.length,
      hasMore: remoteHasMore || localBatchFull,
      rounds: 1,
      terminationReason: remoteHasMore
        ? 'remote-page-limit'
        : localBatchFull
          ? 'local-batch-pending'
          : 'queue-drained',
      remoteHasMore,
      localBatchFull,
      remainingMutationsAtLeast,
      remainingAttemptsAtLeast,
    };
  } catch (caught) {
    return failedRound(caught);
  }
}

function mergeStatus(current: MemorySyncStatus, next: MemorySyncStatus): MemorySyncStatus {
  if (next === 'offline' || next === 'error') return next;
  if (current === 'conflict' || next === 'conflict') return 'conflict';
  return next;
}

function mergeFailureDetails(current: MemorySyncResult, next: MemorySyncResult): Partial<MemorySyncResult> {
  if (!next.errorKind) return current.errorKind ? {
    errorMessage: current.errorMessage,
    errorKind: current.errorKind,
    retryable: current.retryable,
    retryPolicy: current.retryPolicy,
    retryAfterMs: current.retryAfterMs,
    diagnostic: current.diagnostic,
  } : {};
  return {
    errorMessage: next.errorMessage,
    errorKind: next.errorKind,
    retryable: next.retryable,
    retryPolicy: next.retryPolicy,
    retryAfterMs: next.retryAfterMs,
    diagnostic: next.diagnostic,
  };
}

function pendingMessage(result: Pick<MemorySyncResult, 'terminationReason' | 'remainingMutationsAtLeast' | 'remainingAttemptsAtLeast'>): string | undefined {
  if (result.terminationReason === 'remote-page-limit') {
    return 'クラウド側に続きのデータがあります。同期は次の処理で継続します';
  }
  if (result.terminationReason === 'local-batch-pending') {
    const parts = [
      (result.remainingMutationsAtLeast ?? 0) > 0 ? `編集データが少なくとも${result.remainingMutationsAtLeast}件` : '',
      (result.remainingAttemptsAtLeast ?? 0) > 0 ? `回答履歴が少なくとも${result.remainingAttemptsAtLeast}件` : '',
    ].filter(Boolean);
    return `${parts.length > 0 ? parts.join('、') : '未送信データ'}残っています。同期は次の処理で継続します`;
  }
  return undefined;
}

async function performSync(repository: MemoryRepository): Promise<MemorySyncResult> {
  let aggregate: MemorySyncResult = {
    status: 'idle', uploadedMutations: 0, uploadedAttempts: 0, conflicts: 0, hasMore: false,
    rounds: 0, remainingMutationsAtLeast: 0, remainingAttemptsAtLeast: 0,
  };
  let lastRound: MemorySyncRoundResult | undefined;
  // A normal first sync must drain server pagination; otherwise a fresh device
  // would stop after the first 500 change rows until another lifecycle event.
  for (let round = 0; round < MEMORY_INITIAL_PULL_ROUNDS; round += 1) {
    lastRound = await performSyncRound(repository);
    aggregate = {
      status: mergeStatus(aggregate.status, lastRound.status),
      uploadedMutations: aggregate.uploadedMutations + lastRound.uploadedMutations,
      uploadedAttempts: aggregate.uploadedAttempts + lastRound.uploadedAttempts,
      conflicts: aggregate.conflicts + lastRound.conflicts,
      hasMore: lastRound.hasMore,
      rounds: (aggregate.rounds ?? 0) + 1,
      terminationReason: lastRound.terminationReason,
      remainingMutationsAtLeast: lastRound.remainingMutationsAtLeast,
      remainingAttemptsAtLeast: lastRound.remainingAttemptsAtLeast,
      ...mergeFailureDetails(aggregate, lastRound),
    };
    if (lastRound.status === 'offline' || lastRound.status === 'error' || !lastRound.remoteHasMore) break;
  }
  if (lastRound?.remoteHasMore) {
    aggregate.hasMore = true;
    aggregate.limitReached = true;
    aggregate.terminationReason = 'remote-page-limit';
  }
  aggregate.errorMessage ??= pendingMessage(aggregate);
  return aggregate;
}

function cooldownResult(state: MemorySyncRetryState, now: number): MemorySyncResult {
  const retryAfterMs = Math.max(0, state.retryAt - now);
  return {
    ...state.lastFailure,
    hasMore: true,
    retryAfterMs,
    errorMessage: state.lastFailure.status === 'offline'
      ? state.lastFailure.errorMessage
      : `同期を再試行するまで${Math.max(1, Math.ceil(retryAfterMs / 1_000))}秒待機しています。手動同期は今すぐ実行できます`,
  };
}

/** Serializes sync per repository so visibility/online/answer thresholds cannot race. */
export function syncMemory(
  repository: MemoryRepository,
  options: MemorySyncOptions = {},
): Promise<MemorySyncResult> {
  const current = activeSyncs.get(repository);
  if (current) return current;

  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const retryState = retryStates.get(repository);
  if (!options.force && retryState && retryState.retryAt > now()) {
    return Promise.resolve(cooldownResult(retryState, now()));
  }

  const running = performSync(repository).then((result) => {
    if (shouldBackoff(result)) {
      const failures = (retryStates.get(repository)?.failures ?? 0) + 1;
      const delay = memorySyncBackoffDelay(failures, random());
      const withDelay = { ...result, hasMore: true, retryAfterMs: delay };
      retryStates.set(repository, { failures, retryAt: now() + delay, lastFailure: withDelay });
      return withDelay;
    }
    retryStates.delete(repository);
    return result;
  }).finally(() => activeSyncs.delete(repository));
  activeSyncs.set(repository, running);
  return running;
}

export async function flushMemorySync(
  repository: MemoryRepository,
  maximumRounds = MEMORY_FLUSH_MAXIMUM_ROUNDS,
  options: MemorySyncOptions = {},
): Promise<MemorySyncResult> {
  let aggregate: MemorySyncResult = {
    status: 'idle',
    uploadedMutations: 0,
    uploadedAttempts: 0,
    conflicts: 0,
    hasMore: false,
    rounds: 0,
    remainingMutationsAtLeast: 0,
    remainingAttemptsAtLeast: 0,
  };
  let completedRounds = 0;
  for (; completedRounds < maximumRounds; completedRounds += 1) {
    const result = await syncMemory(repository, options);
    aggregate = {
      status: mergeStatus(aggregate.status, result.status),
      uploadedMutations: aggregate.uploadedMutations + result.uploadedMutations,
      uploadedAttempts: aggregate.uploadedAttempts + result.uploadedAttempts,
      conflicts: aggregate.conflicts + result.conflicts,
      hasMore: result.hasMore,
      rounds: (aggregate.rounds ?? 0) + (result.rounds ?? 1),
      terminationReason: result.terminationReason,
      remainingMutationsAtLeast: result.remainingMutationsAtLeast,
      remainingAttemptsAtLeast: result.remainingAttemptsAtLeast,
      ...mergeFailureDetails(aggregate, result),
    };
    if (result.status === 'offline' || result.status === 'error' || !result.hasMore) break;
  }
  if (aggregate.hasMore && completedRounds >= maximumRounds) {
    aggregate.limitReached = true;
    aggregate.terminationReason = 'flush-round-limit';
    aggregate.errorMessage = `同期処理の上限（${maximumRounds}回）に達しました。未送信データは端末に残っており、次の同期で続きから処理します`;
  } else {
    aggregate.errorMessage ??= pendingMessage(aggregate);
  }
  return aggregate;
}
