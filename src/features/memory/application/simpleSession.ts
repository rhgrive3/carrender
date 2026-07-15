import type { LearningTarget, MemorySession, MemorySessionConfig } from '../domain/types';
import { createSessionQueue } from '../domain/sessionQueue';
import { generateLearningTargets, resolveQuestionCount, selectLearningTargets } from '../domain/targets';
import { createMemoryId, MemoryRepository } from '../infrastructure/repositories';

export interface CreatedSimpleSession {
  session: MemorySession;
  targets: LearningTarget[];
}

export async function createSimpleStudySession(input: {
  repository: MemoryRepository;
  selectedSetIds: string[];
  config: MemorySessionConfig;
  seed?: string;
}): Promise<CreatedSimpleSession> {
  const selectedSetIds = [...new Set(input.selectedSetIds)];
  if (selectedSetIds.length === 0) throw new Error('学習するセットを選択してください');

  const direction = input.config.direction === 'input' ? 'input' : 'output';
  const bundle = await input.repository.loadSetBundle(selectedSetIds);
  const eligible = generateLearningTargets({
    content: bundle,
    setMembers: bundle.setMembers,
    selectedSetIds,
    direction,
    includeUnverifiedAi: false,
  }).filter((target) => !target.exerciseId && (target.mode === 'input' || target.mode === 'output'));

  if (eligible.length === 0) throw new Error('このセットに出題できるカードがありません');
  const count = resolveQuestionCount(eligible.length, input.config.questionCount);
  const seed = input.seed ?? createMemoryId('seed');
  const stats = await input.repository.getStats();
  const targets = selectLearningTargets({
    targets: eligible,
    stats,
    count,
    seed,
    strategy: input.config.questionCount.type === 'weak' ? 'weak' : 'adaptive',
  });
  const queue = createSessionQueue(targets, seed);
  const now = new Date().toISOString();
  const config: MemorySessionConfig = {
    questionCount: input.config.questionCount,
    direction,
    includeUnverifiedAi: false,
    preferredExerciseType: 'flashcard',
  };
  const session: MemorySession = {
    id: createMemoryId('memory-session'),
    status: queue.status === 'completed' ? 'completed' : 'active',
    selectedSetIds,
    initialTargetIds: targets.map((target) => target.id),
    config,
    seed,
    currentTargetId: queue.currentTargetId,
    queueState: { applicationVersion: 1, queue },
    completedTargetIds: [],
    needsReviewTargetIds: [],
    answerCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await input.repository.startSession(session);
  return { session, targets };
}
