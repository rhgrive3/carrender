import type {
  Assessment,
  ErrorType,
  ExerciseType,
  LearningTarget,
  MemoryAttempt,
  MemoryContentBundle,
  MemorySession,
  MemorySessionConfig,
  MemoryStat,
} from '../domain/types';
import {
  answerCurrentQuestion,
  createSessionQueue,
  currentLearningTarget,
  isValidSessionQueueSnapshot,
  sessionQueueProgress,
  undoLastSessionAnswer,
  type SessionQueueState,
} from '../domain/sessionQueue';
import {
  generateLearningTargets,
  resolveQuestionCount,
  selectLearningTargets,
  selectionModeWeights,
} from '../domain/targets';
import { calculateStatUpdates } from './stats';
import { createMemoryId, MemoryRepository } from '../infrastructure/repositories';

interface QueueUndoData {
  attemptId: string;
  previousStats: MemoryStat[];
}

interface PersistedQueueEnvelope {
  applicationVersion: 1;
  queue: SessionQueueState;
  undo?: QueueUndoData;
}

export interface CreatedMemorySession {
  session: MemorySession;
  targets: LearningTarget[];
}

export function queueFromSession(session: MemorySession): SessionQueueState {
  const value = session.queueState;
  if (value && typeof value === 'object' && (value as Partial<PersistedQueueEnvelope>).applicationVersion === 1) {
    const queue = (value as PersistedQueueEnvelope).queue;
    if (isValidSessionQueueSnapshot(queue)) return queue;
  }
  if (isValidSessionQueueSnapshot(value)) return value as SessionQueueState;
  throw new Error('保存された学習セッションを復元できません');
}

/**
 * Validates a persisted queue against the current local knowledge base. This
 * prevents a resumed Input question from silently grading one Sense after a
 * newly added sibling made its contextless prompt ambiguous.
 */
export function sessionContentIsRestorable(
  content: MemoryContentBundle,
  targets: readonly LearningTarget[],
  includeUnverifiedAi: boolean,
): boolean {
  const items = new Map(content.items.filter((value) => !value.deletedAt).map((value) => [value.id, value]));
  const senses = new Map(content.senses.filter((value) => !value.deletedAt).map((value) => [value.id, value]));
  const answers = new Map(content.answers.filter((value) => !value.deletedAt).map((value) => [value.id, value]));
  const exercises = new Map(content.exercises.filter((value) => !value.deletedAt).map((value) => [value.id, value]));
  const recordAllowed = (verificationStatus: 'verified' | 'unverified_ai') =>
    includeUnverifiedAi || verificationStatus === 'verified';
  const eligibleSenseCounts = new Map<string, number>();
  for (const sense of senses.values()) {
    const item = items.get(sense.itemId);
    if (!item || !recordAllowed(item.verificationStatus) || !recordAllowed(sense.verificationStatus)) continue;
    eligibleSenseCounts.set(sense.itemId, (eligibleSenseCounts.get(sense.itemId) ?? 0) + 1);
  }
  const contextSenseIds = new Set(content.examples.filter((example) =>
    !example.deletedAt && senses.has(example.senseId) && recordAllowed(example.verificationStatus))
    .map((example) => example.senseId));

  return targets.every((target) => {
    const item = items.get(target.itemId);
    const sense = senses.get(target.senseId);
    if (!item || !sense || sense.itemId !== item.id
      || !recordAllowed(item.verificationStatus) || !recordAllowed(sense.verificationStatus)) return false;
    if (target.mode === 'input'
      && (eligibleSenseCounts.get(item.id) ?? 0) > 1
      && !contextSenseIds.has(sense.id)) return false;
    if (target.answerId) {
      const answer = answers.get(target.answerId);
      if (!answer || answer.senseId !== sense.id || !recordAllowed(answer.verificationStatus)) return false;
    }
    if (target.exerciseId) {
      const exercise = exercises.get(target.exerciseId);
      if (!exercise || exercise.senseId !== sense.id || !recordAllowed(exercise.verificationStatus)) return false;
    }
    if (target.mode === 'output' && !target.exerciseId) {
      const hasAnswer = [...answers.values()].some((answer) =>
        answer.senseId === sense.id && recordAllowed(answer.verificationStatus));
      if (!hasAnswer) return false;
    }
    return true;
  });
}

function envelope(queue: SessionQueueState, undo?: QueueUndoData): PersistedQueueEnvelope {
  return { applicationVersion: 1, queue, undo };
}

function envelopeFromSession(session: MemorySession): PersistedQueueEnvelope | undefined {
  const value = session.queueState;
  return value && typeof value === 'object' && (value as Partial<PersistedQueueEnvelope>).applicationVersion === 1
    ? value as PersistedQueueEnvelope
    : undefined;
}

export async function createStudySession(input: {
  repository: MemoryRepository;
  selectedSetIds: string[];
  config: MemorySessionConfig;
  seed?: string;
}): Promise<CreatedMemorySession> {
  const selectedSetIds = [...new Set(input.selectedSetIds)];
  if (selectedSetIds.length === 0) throw new Error('学習するセットを選択してください');
  const bundle = await input.repository.loadSetBundle(selectedSetIds);
  let eligible = generateLearningTargets({
    content: bundle,
    setMembers: bundle.setMembers,
    selectedSetIds,
    direction: input.config.direction,
    includeUnverifiedAi: input.config.includeUnverifiedAi,
  });
  if (eligible.length === 0) throw new Error('選択した条件で出題できる項目がありません');
  const count = resolveQuestionCount(eligible.length, input.config.questionCount);
  const seed = input.seed ?? createMemoryId('seed');
  const stats = await input.repository.getStats();
  const targets = selectLearningTargets({
    targets: eligible,
    stats,
    count,
    seed,
    modeWeights: selectionModeWeights(input.config),
  });
  const queue = createSessionQueue(targets, seed);
  const now = new Date().toISOString();
  const session: MemorySession = {
    id: createMemoryId('memory-session'),
    status: queue.status === 'completed' ? 'completed' : 'active',
    selectedSetIds,
    initialTargetIds: targets.map((target) => target.id),
    config: input.config,
    seed,
    currentTargetId: queue.currentTargetId,
    queueState: envelope(queue),
    completedTargetIds: [],
    needsReviewTargetIds: [],
    answerCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await input.repository.startSession(session);
  return { session, targets };
}

export interface AnswerMemoryQuestionInput {
  repository: MemoryRepository;
  session: MemorySession;
  assessment: Assessment;
  clientId: string;
  answerId?: string;
  userAnswer?: string;
  normalizedAnswer?: string;
  errorTypes?: ErrorType[];
  hintUsed?: boolean;
  responseMs: number;
  /** The format actually presented when UI configuration overrides the target. */
  presentedExerciseType?: ExerciseType;
}

export interface AnsweredMemoryQuestion {
  attempt: MemoryAttempt;
  session: MemorySession;
  queue: SessionQueueState;
  graduated: boolean;
  needsReview: boolean;
}

export async function answerMemoryQuestion(input: AnswerMemoryQuestionInput): Promise<AnsweredMemoryQuestion> {
  const queue = queueFromSession(input.session);
  const target = currentLearningTarget(queue);
  if (!target) throw new Error('回答する問題がありません');
  const answer = answerCurrentQuestion(queue, input.assessment);
  const now = new Date().toISOString();
  const attempt: MemoryAttempt = {
    attemptId: createMemoryId('attempt'),
    sessionId: input.session.id,
    clientId: input.clientId,
    itemId: target.itemId,
    senseId: target.senseId,
    answerId: input.answerId ?? target.answerId,
    exerciseId: target.exerciseId,
    targetId: target.id,
    mode: target.mode,
    exerciseType: input.presentedExerciseType ?? target.exerciseType,
    userAnswer: input.userAnswer,
    normalizedAnswer: input.normalizedAnswer,
    assessment: input.assessment,
    errorTypes: input.errorTypes ?? [],
    hintUsed: input.hintUsed ?? false,
    responseMs: Math.max(0, Math.round(input.responseMs)),
    createdAt: now,
  };
  const statUpdates = await calculateStatUpdates(input.repository, attempt);
  const progress = sessionQueueProgress(answer.state);
  const session: MemorySession = {
    ...input.session,
    status: progress.complete ? 'completed' : 'active',
    currentTargetId: answer.state.currentTargetId,
    queueState: envelope(answer.state, { attemptId: attempt.attemptId, previousStats: statUpdates.previous }),
    completedTargetIds: [...answer.state.completedTargetIds],
    needsReviewTargetIds: [...answer.state.needsReviewTargetIds],
    answerCount: answer.state.answerCount,
    updatedAt: now,
    completedAt: progress.complete ? now : undefined,
  };
  await input.repository.saveAttempt(attempt, statUpdates.updated, session);
  return { attempt, session, queue: answer.state, graduated: answer.graduated, needsReview: answer.needsReview };
}

export async function undoMemoryAnswer(
  repository: MemoryRepository,
  session: MemorySession,
): Promise<{ session: MemorySession; queue: SessionQueueState } | null> {
  const persisted = envelopeFromSession(session);
  if (!persisted?.undo) return null;
  const undone = undoLastSessionAnswer(persisted.queue);
  if (!undone.didUndo) return null;
  const now = new Date().toISOString();
  const restored: MemorySession = {
    ...session,
    status: 'active',
    currentTargetId: undone.state.currentTargetId,
    queueState: envelope(undone.state),
    completedTargetIds: [...undone.state.completedTargetIds],
    needsReviewTargetIds: [...undone.state.needsReviewTargetIds],
    answerCount: undone.state.answerCount,
    updatedAt: now,
    completedAt: undefined,
  };
  await repository.undoAttempt(persisted.undo.attemptId, persisted.undo.previousStats, restored);
  return { session: restored, queue: undone.state };
}

export function currentSessionTarget(session: MemorySession): LearningTarget | undefined {
  return currentLearningTarget(queueFromSession(session));
}
