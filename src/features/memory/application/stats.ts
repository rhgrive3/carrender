import type { MemoryAttempt, MemoryMode, MemoryStat, MemoryTargetType } from '../domain/types';
import {
  applyAttemptToStat,
  computeWeakness,
  createEmptyStat,
  masteryForStat,
  statKey,
} from '../domain/weakness';
import { MemoryRepository, statId } from '../infrastructure/repositories';

interface StatTarget {
  targetType: MemoryTargetType;
  targetId: string;
  mode: MemoryMode;
}

export interface StatUpdateResult {
  previous: MemoryStat[];
  updated: MemoryStat[];
}

function targetsForAttempt(attempt: MemoryAttempt): StatTarget[] {
  // A concrete exercise is an explicitly constrained task. It must not make the
  // broader Sense look mastered merely because the designated form worked.
  const targets: StatTarget[] = attempt.exerciseId
    ? []
    : [{ targetType: 'sense', targetId: attempt.senseId, mode: attempt.mode }];
  if (attempt.answerId) targets.push({ targetType: 'answer', targetId: attempt.answerId, mode: attempt.mode });
  if (attempt.exerciseId) targets.push({ targetType: 'exercise', targetId: attempt.exerciseId, mode: attempt.mode });
  return targets;
}

export async function calculateStatUpdates(
  repository: MemoryRepository,
  attempt: MemoryAttempt,
): Promise<StatUpdateResult> {
  const targets = targetsForAttempt(attempt);
  // Never scan every aggregate on the answer critical path. Direction-gap
  // calculation only needs the four modes for the concrete targets updated by
  // this Attempt.
  const allStats = await repository.getStats(new Set(targets.map((target) => target.targetId)));
  const byKey = new Map(allStats.map((stat) => [statKey(stat.targetType, stat.targetId, stat.mode), stat]));
  const previous: MemoryStat[] = [];
  const updated: MemoryStat[] = [];

  for (const target of targets) {
    const key = statKey(target.targetType, target.targetId, target.mode);
    const before = byKey.get(key) ?? createEmptyStat({
      id: statId(target.targetType, target.targetId, target.mode),
      targetType: target.targetType,
      targetId: target.targetId,
      mode: target.mode,
      now: attempt.createdAt,
    });
    previous.push(before);
    const applied = applyAttemptToStat(before, attempt);
    const forSameTarget = (mode: MemoryMode) => {
      if (mode === target.mode) return applied;
      return byKey.get(statKey(target.targetType, target.targetId, mode));
    };
    const recent = await repository.getStatTargetAttempts(target.targetType, target.targetId, target.mode, 4);
    const weakness = computeWeakness({
      stat: applied,
      attemptsNewestFirst: [attempt, ...recent],
      responseContext: {
        exerciseType: attempt.exerciseType,
        // The attempt stores the learner's response, not the expected answer.
        // Feeding its length into expectedAnswerLength made weakness vary with
        // what the learner typed and let the latest answer rewrite historical
        // response-time difficulty. Until expected content length is persisted,
        // use the exercise-type baseline only.
      },
      inputMastery: masteryForStat(forSameTarget('input')),
      outputMastery: masteryForStat(forSameTarget('output')),
      contextMastery: masteryForStat(forSameTarget('context')),
    });
    const next = { ...applied, weaknessScore: weakness.score };
    updated.push(next);
    byKey.set(key, next);
  }
  return { previous, updated };
}
