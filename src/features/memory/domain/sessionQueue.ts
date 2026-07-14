import type { Assessment, LearningTarget } from './types';
import {
  deterministicShuffle,
  randomIntegerInclusive,
  seedToRandomState,
} from './seededRandom';

export const MAX_SESSION_TARGET_ATTEMPTS = 5;

export type SessionTargetStatus = 'active' | 'graduated' | 'needs_review';

export interface SessionTargetProgress {
  targetId: string;
  attempts: number;
  incorrectCount: number;
  partialCount: number;
  skippedCount: number;
  consecutiveCorrect: number;
  hasEverStruggled: boolean;
  status: SessionTargetStatus;
}

export interface SessionQueueEntry {
  targetId: string;
  /** Entry should normally remain behind this many already-recorded answers. */
  notBeforeAnswerCount: number;
  scheduledGap: number;
}

export interface SessionAnswerRecord {
  answerNumber: number;
  targetId: string;
  assessment: Assessment;
  scheduledGap?: number;
  graduated: boolean;
  needsReview: boolean;
}

/** Serializable state saved to IndexedDB after each confirmed answer. */
export interface SessionQueueSnapshot {
  version: 1;
  seed: string;
  rngState: number;
  targetsById: Record<string, LearningTarget>;
  initialTargetIds: string[];
  queue: SessionQueueEntry[];
  progressByTargetId: Record<string, SessionTargetProgress>;
  currentTargetId?: string;
  currentSelectionRelaxedInterval: boolean;
  lastAnsweredSiblingGroupId?: string;
  completedTargetIds: string[];
  needsReviewTargetIds: string[];
  answerCount: number;
  history: SessionAnswerRecord[];
  status: 'active' | 'completed';
}

export interface SessionQueueState extends SessionQueueSnapshot {
  /** Exactly one answer can be undone; snapshots themselves never recurse. */
  undo?: {
    answeredTargetId: string;
    snapshot: SessionQueueSnapshot;
  };
}

function cloneTarget(target: LearningTarget): LearningTarget {
  return { ...target };
}

export function snapshotSessionQueue(state: SessionQueueState): SessionQueueSnapshot {
  return {
    version: 1,
    seed: state.seed,
    rngState: state.rngState,
    targetsById: Object.fromEntries(
      Object.entries(state.targetsById).map(([id, target]) => [id, cloneTarget(target)]),
    ),
    initialTargetIds: [...state.initialTargetIds],
    queue: state.queue.map((entry) => ({ ...entry })),
    progressByTargetId: Object.fromEntries(
      Object.entries(state.progressByTargetId).map(([id, progress]) => [id, { ...progress }]),
    ),
    currentTargetId: state.currentTargetId,
    currentSelectionRelaxedInterval: state.currentSelectionRelaxedInterval,
    lastAnsweredSiblingGroupId: state.lastAnsweredSiblingGroupId,
    completedTargetIds: [...state.completedTargetIds],
    needsReviewTargetIds: [...state.needsReviewTargetIds],
    answerCount: state.answerCount,
    history: state.history.map((record) => ({ ...record })),
    status: state.status,
  };
}

function reorderInitialTargets(targets: readonly LearningTarget[], rngState: number): {
  targets: LearningTarget[];
  rngState: number;
} {
  const shuffled = deterministicShuffle(targets, rngState);
  const pool = [...shuffled.values];
  const ordered: LearningTarget[] = [];
  while (pool.length > 0) {
    const previous = ordered[ordered.length - 1];
    const index = previous
      ? pool.findIndex((candidate) => candidate.siblingGroupId !== previous.siblingGroupId)
      : 0;
    ordered.push(pool.splice(index >= 0 ? index : 0, 1)[0]);
  }
  return { targets: ordered, rngState: shuffled.state };
}

function chooseNextQuestion(snapshot: SessionQueueSnapshot): SessionQueueSnapshot {
  if (snapshot.currentTargetId || snapshot.queue.length === 0) {
    return snapshot.queue.length === 0 && !snapshot.currentTargetId
      ? { ...snapshot, status: 'completed' }
      : snapshot;
  }

  const readyIndices = snapshot.queue
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.notBeforeAnswerCount <= snapshot.answerCount)
    .map(({ index }) => index);
  const lastGroup = snapshot.lastAnsweredSiblingGroupId;
  const isNonSibling = (index: number) => {
    const target = snapshot.targetsById[snapshot.queue[index].targetId];
    return !lastGroup || target?.siblingGroupId !== lastGroup;
  };

  let selectedIndex = readyIndices.find(isNonSibling);
  let relaxed = false;
  if (selectedIndex === undefined && lastGroup) {
    // Prefer any non-sibling over an immediate sibling, even when a small retry
    // interval must be compressed because the target pool is tiny.
    selectedIndex = snapshot.queue.findIndex((_, index) => isNonSibling(index));
    relaxed = selectedIndex >= 0
      && snapshot.queue[selectedIndex].notBeforeAnswerCount > snapshot.answerCount;
  }
  if (selectedIndex === undefined || selectedIndex < 0) {
    selectedIndex = readyIndices[0] ?? 0;
    relaxed = snapshot.queue[selectedIndex].notBeforeAnswerCount > snapshot.answerCount;
  }

  const queue = [...snapshot.queue];
  const [selected] = queue.splice(selectedIndex, 1);
  return {
    ...snapshot,
    queue,
    currentTargetId: selected.targetId,
    currentSelectionRelaxedInterval: relaxed,
    status: 'active',
  };
}

export function createSessionQueue(
  targets: readonly LearningTarget[],
  seed: string,
): SessionQueueState {
  const uniqueTargets = [...new Map(targets.map((target) => [target.id, target])).values()];
  const ordered = reorderInitialTargets(uniqueTargets, seedToRandomState(seed));
  const targetsById = Object.fromEntries(uniqueTargets.map((target) => [target.id, cloneTarget(target)]));
  const base: SessionQueueSnapshot = {
    version: 1,
    seed,
    rngState: ordered.rngState,
    targetsById,
    initialTargetIds: uniqueTargets.map((target) => target.id),
    queue: ordered.targets.map((target) => ({ targetId: target.id, notBeforeAnswerCount: 0, scheduledGap: 0 })),
    progressByTargetId: Object.fromEntries(uniqueTargets.map((target) => [target.id, {
      targetId: target.id,
      attempts: 0,
      incorrectCount: 0,
      partialCount: 0,
      skippedCount: 0,
      consecutiveCorrect: 0,
      hasEverStruggled: false,
      status: 'active' as const,
    }])),
    currentSelectionRelaxedInterval: false,
    completedTargetIds: [],
    needsReviewTargetIds: [],
    answerCount: 0,
    history: [],
    status: uniqueTargets.length === 0 ? 'completed' : 'active',
  };
  return chooseNextQuestion(base);
}

function retryGap(
  assessment: Assessment,
  incorrectCount: number,
  rngState: number,
): { gap: number; rngState: number } {
  let minimum: number;
  let maximum: number;
  if (assessment === 'partial') {
    minimum = 3;
    maximum = 5;
  } else if (assessment === 'correct') {
    // The second clean recall must have at least one intervening question.
    minimum = 1;
    maximum = 2;
  } else if (incorrectCount <= 1) {
    minimum = 4;
    maximum = 7;
  } else if (incorrectCount === 2) {
    minimum = 3;
    maximum = 5;
  } else {
    minimum = 2;
    maximum = 4;
  }
  const step = randomIntegerInclusive(rngState, minimum, maximum);
  return { gap: step.value, rngState: step.state };
}

function insertRetry(
  queue: readonly SessionQueueEntry[],
  entry: SessionQueueEntry,
): SessionQueueEntry[] {
  const next = [...queue];
  // scheduledGap means the desired number of other questions before this retry.
  next.splice(Math.min(entry.scheduledGap, next.length), 0, entry);
  return next;
}

export interface AnswerSessionResult {
  state: SessionQueueState;
  targetId: string;
  graduated: boolean;
  needsReview: boolean;
  scheduledGap?: number;
}

export function answerCurrentQuestion(
  state: SessionQueueState,
  assessment: Assessment,
): AnswerSessionResult {
  const targetId = state.currentTargetId;
  if (!targetId) {
    throw new Error('No current learning target to answer');
  }
  const previousSnapshot = snapshotSessionQueue(state);
  const previous = state.progressByTargetId[targetId];
  const target = state.targetsById[targetId];
  if (!previous || !target) throw new Error(`Unknown learning target: ${targetId}`);

  const attempts = previous.attempts + 1;
  const isCorrect = assessment === 'correct';
  const incorrectCount = previous.incorrectCount
    + (assessment === 'incorrect' || assessment === 'skipped' ? 1 : 0);
  const partialCount = previous.partialCount + (assessment === 'partial' ? 1 : 0);
  const skippedCount = previous.skippedCount + (assessment === 'skipped' ? 1 : 0);
  const hasEverStruggled = previous.hasEverStruggled || !isCorrect;
  const consecutiveCorrect = isCorrect ? previous.consecutiveCorrect + 1 : 0;
  let graduated = isCorrect && (!hasEverStruggled || consecutiveCorrect >= 2);
  let needsReview = false;
  if (!graduated && attempts >= MAX_SESSION_TARGET_ATTEMPTS) needsReview = true;

  const status: SessionTargetStatus = graduated
    ? 'graduated'
    : needsReview ? 'needs_review' : 'active';
  const progress: SessionTargetProgress = {
    targetId,
    attempts,
    incorrectCount,
    partialCount,
    skippedCount,
    consecutiveCorrect,
    hasEverStruggled,
    status,
  };
  const answerCount = state.answerCount + 1;
  let rngState = state.rngState;
  let queue = state.queue.filter((entry) => entry.targetId !== targetId);
  let scheduledGap: number | undefined;
  if (!graduated && !needsReview) {
    const interval = retryGap(assessment, incorrectCount, rngState);
    scheduledGap = interval.gap;
    rngState = interval.rngState;
    queue = insertRetry(queue, {
      targetId,
      notBeforeAnswerCount: answerCount + interval.gap,
      scheduledGap: interval.gap,
    });
  }

  const completedTargetIds = graduated
    ? [...state.completedTargetIds.filter((id) => id !== targetId), targetId]
    : state.completedTargetIds.filter((id) => id !== targetId);
  const needsReviewTargetIds = needsReview
    ? [...state.needsReviewTargetIds.filter((id) => id !== targetId), targetId]
    : state.needsReviewTargetIds.filter((id) => id !== targetId);
  const record: SessionAnswerRecord = {
    answerNumber: answerCount,
    targetId,
    assessment,
    scheduledGap,
    graduated,
    needsReview,
  };
  const nextSnapshot = chooseNextQuestion({
    ...snapshotSessionQueue(state),
    rngState,
    queue,
    progressByTargetId: { ...state.progressByTargetId, [targetId]: progress },
    currentTargetId: undefined,
    currentSelectionRelaxedInterval: false,
    lastAnsweredSiblingGroupId: target.siblingGroupId,
    completedTargetIds,
    needsReviewTargetIds,
    answerCount,
    history: [...state.history, record],
    status: queue.length === 0 ? 'completed' : 'active',
  });
  const nextState: SessionQueueState = {
    ...nextSnapshot,
    undo: { answeredTargetId: targetId, snapshot: previousSnapshot },
  };
  return { state: nextState, targetId, graduated, needsReview, scheduledGap };
}

export interface UndoSessionResult {
  state: SessionQueueState;
  undoneTargetId?: string;
  didUndo: boolean;
}

export function undoLastSessionAnswer(state: SessionQueueState): UndoSessionResult {
  if (!state.undo) return { state, didUndo: false };
  return {
    state: { ...snapshotSessionQueue(state.undo.snapshot) },
    undoneTargetId: state.undo.answeredTargetId,
    didUndo: true,
  };
}

export function currentLearningTarget(state: SessionQueueState): LearningTarget | undefined {
  return state.currentTargetId ? state.targetsById[state.currentTargetId] : undefined;
}

export interface SessionQueueProgress {
  graduated: number;
  needsReview: number;
  total: number;
  answerCount: number;
  complete: boolean;
}

export function sessionQueueProgress(state: SessionQueueState): SessionQueueProgress {
  return {
    graduated: state.completedTargetIds.length,
    needsReview: state.needsReviewTargetIds.length,
    total: state.initialTargetIds.length,
    answerCount: state.answerCount,
    complete: state.status === 'completed',
  };
}

/** Validates restored data before it is trusted as an active queue. */
export function isValidSessionQueueSnapshot(value: unknown): value is SessionQueueSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SessionQueueSnapshot>;
  if (candidate.version !== 1 || typeof candidate.seed !== 'string') return false;
  if (!Number.isInteger(candidate.rngState) || !Number.isInteger(candidate.answerCount) || (candidate.answerCount ?? -1) < 0) return false;
  if (!candidate.targetsById || typeof candidate.targetsById !== 'object') return false;
  if (!candidate.progressByTargetId || typeof candidate.progressByTargetId !== 'object') return false;
  if (!Array.isArray(candidate.initialTargetIds) || !Array.isArray(candidate.queue)) return false;
  if (!Array.isArray(candidate.completedTargetIds) || !Array.isArray(candidate.needsReviewTargetIds)) return false;
  if (!Array.isArray(candidate.history)) return false;
  if (candidate.status !== 'active' && candidate.status !== 'completed') return false;
  const ids = new Set(Object.keys(candidate.targetsById));
  const initialIds = candidate.initialTargetIds;
  const completedIds = candidate.completedTargetIds;
  const needsReviewIds = candidate.needsReviewTargetIds;
  if (new Set(initialIds).size !== initialIds.length || !initialIds.every((id) => typeof id === 'string' && ids.has(id))) return false;
  if (candidate.history.length !== candidate.answerCount) return false;
  const scheduledIds = [
    ...candidate.queue.map((entry) => entry.targetId),
    ...(candidate.currentTargetId ? [candidate.currentTargetId] : []),
  ];
  if (new Set(scheduledIds).size !== scheduledIds.length) return false;
  if (!completedIds.every((id) => ids.has(id)) || !needsReviewIds.every((id) => ids.has(id))) return false;
  if (completedIds.some((id) => needsReviewIds.includes(id))) return false;
  return candidate.queue.every((entry) =>
      !!entry
      && typeof entry.targetId === 'string'
      && ids.has(entry.targetId)
      && Number.isInteger(entry.notBeforeAnswerCount)
      && entry.notBeforeAnswerCount >= 0
      && Number.isInteger(entry.scheduledGap)
      && entry.scheduledGap >= 0,
    )
    && (!candidate.currentTargetId || ids.has(candidate.currentTargetId))
    && initialIds.every((id) => {
      const progress = candidate.progressByTargetId?.[id];
      return !!progress
        && progress.targetId === id
        && Number.isInteger(progress.attempts)
        && progress.attempts >= 0
        && progress.attempts <= MAX_SESSION_TARGET_ATTEMPTS
        && ['active', 'graduated', 'needs_review'].includes(progress.status);
    });
}
