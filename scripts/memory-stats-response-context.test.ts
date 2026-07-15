/** Regression coverage for stable response-time weakness scoring. */
/// <reference types="node" />
import { calculateStatUpdates } from '../src/features/memory/application/stats';
import type { MemoryAttempt, MemoryStat } from '../src/features/memory/domain/types';
import type { MemoryRepository } from '../src/features/memory/infrastructure/repositories';

function repository(): MemoryRepository {
  return {
    getStats: async () => [] as MemoryStat[],
    getStatTargetAttempts: async () => [],
  } as unknown as MemoryRepository;
}

function attempt(userAnswer: string): MemoryAttempt {
  return {
    attemptId: `attempt-${userAnswer.length}`,
    sessionId: 'session-1',
    clientId: 'client-1',
    itemId: 'item-1',
    senseId: 'sense-1',
    targetId: 'output|sense=sense-1',
    mode: 'output',
    exerciseType: 'typed_output',
    userAnswer,
    normalizedAnswer: userAnswer.trim().toLowerCase(),
    assessment: 'incorrect',
    errorTypes: [],
    hintUsed: false,
    responseMs: 12_000,
    createdAt: '2026-07-15T00:00:00.000Z',
  };
}

const short = await calculateStatUpdates(repository(), attempt('x'));
const long = await calculateStatUpdates(repository(), attempt('x'.repeat(120)));
const shortScore = short.updated[0]?.weaknessScore;
const longScore = long.updated[0]?.weaknessScore;

if (shortScore !== longScore) {
  console.error('❌ User response length changed weakness scoring', { shortScore, longScore });
  process.exit(1);
}

console.log('✅ Weakness scoring is independent of learner response length');
