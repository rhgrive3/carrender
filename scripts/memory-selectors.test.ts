/** Learning Target -> representative stat selection verification. */
/// <reference types="node" />
import {
  selectLearningTargetStatEntries,
  selectStatsForLearningTargets,
  statRefForLearningTarget,
  summarizeLearningTargetStats,
} from '../src/features/memory/domain/selectors';
import type { LearningTarget, MemoryMode, MemoryStat, MemoryTargetType } from '../src/features/memory/domain/types';

let failures = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.error(`  ❌ ${name}`, detail ?? '');
  }
}

function target(
  id: string,
  mode: MemoryMode,
  over: Partial<LearningTarget> = {},
): LearningTarget {
  return {
    id,
    mode,
    itemId: 'item-1',
    senseId: 'sense-1',
    exerciseType: mode === 'composition' ? 'guided_composition' : mode === 'context' ? 'fill_blank' : 'flashcard',
    siblingGroupId: 'item:item-1',
    verificationStatus: 'verified',
    ...over,
  };
}

function stat(
  targetType: MemoryTargetType,
  targetId: string,
  mode: MemoryMode,
  over: Partial<MemoryStat> = {},
): MemoryStat {
  return {
    id: `${targetType}:${targetId}:${mode}`,
    targetType,
    targetId,
    mode,
    attempts: 1,
    correctCount: 1,
    partialCount: 0,
    incorrectCount: 0,
    skippedCount: 0,
    consecutiveCorrect: 1,
    consecutiveIncorrect: 0,
    averageResponseMs: 1000,
    hintCount: 0,
    manualWeak: false,
    weaknessScore: 0,
    updatedAt: '2026-07-12T00:00:00.000Z',
    ...over,
  };
}

const inputTarget = target('input|sense=sense-1', 'input');
const outputTarget = target('output|sense=sense-1', 'output');
const contextTarget = target('context|sense=sense-1|answer=answer-1|exercise=exercise-context', 'context', {
  answerId: 'answer-1',
  exerciseId: 'exercise-context',
});
const duplicateContextRef = target('context-alias', 'context', {
  answerId: 'answer-1',
  exerciseId: 'exercise-context',
});
const compositionTarget = target('composition|sense=sense-1|answer=answer-1|exercise=exercise-composition', 'composition', {
  answerId: 'answer-1',
  exerciseId: 'exercise-composition',
});
const specifiedAnswerTarget = target('output|sense=sense-1|answer=answer-2', 'output', {
  answerId: 'answer-2',
});
const unattemptedTarget = target('output|sense=sense-2', 'output', {
  itemId: 'item-2',
  senseId: 'sense-2',
  siblingGroupId: 'item:item-2',
});
const targets = [
  inputTarget,
  inputTarget,
  outputTarget,
  contextTarget,
  duplicateContextRef,
  compositionTarget,
  specifiedAnswerTarget,
  unattemptedTarget,
];

const stats: MemoryStat[] = [
  stat('sense', 'sense-1', 'input', { attempts: 10, correctCount: 9, incorrectCount: 1 }),
  stat('sense', 'sense-1', 'output', { attempts: 10, correctCount: 4, incorrectCount: 6, weaknessScore: 65 }),
  // Auxiliary Answer aggregate from the same constrained Context attempt. It
  // must not be counted alongside the representative Exercise aggregate.
  stat('answer', 'answer-1', 'context', { attempts: 4, correctCount: 4 }),
  stat('exercise', 'exercise-context', 'context', {
    attempts: 4,
    correctCount: 2,
    partialCount: 1,
    incorrectCount: 1,
  }),
  stat('answer', 'answer-1', 'composition', { attempts: 2, correctCount: 2 }),
  stat('exercise', 'exercise-composition', 'composition', {
    attempts: 2,
    correctCount: 0,
    incorrectCount: 2,
    manualWeak: true,
  }),
  stat('answer', 'answer-2', 'output'),
];

console.log('--- Memory selectors: representative stat identity ---');
check(
  '通常Input/Output targetはSense統計を参照',
  statRefForLearningTarget(outputTarget).targetType === 'sense'
    && statRefForLearningTarget(outputTarget).targetId === 'sense-1',
  statRefForLearningTarget(outputTarget),
);
check(
  '指定Answer targetはAnswer統計を参照',
  statRefForLearningTarget(specifiedAnswerTarget).targetType === 'answer'
    && statRefForLearningTarget(specifiedAnswerTarget).targetId === 'answer-2',
  statRefForLearningTarget(specifiedAnswerTarget),
);
check(
  'Exercise targetは補助AnswerでなくExercise統計を参照',
  statRefForLearningTarget(contextTarget).targetType === 'exercise'
    && statRefForLearningTarget(contextTarget).targetId === 'exercise-context',
  statRefForLearningTarget(contextTarget),
);

console.log('--- Memory selectors: deduplication and summaries ---');
const entries = selectLearningTargetStatEntries(targets, stats);
const selectedStats = selectStatsForLearningTargets(targets, stats);
const summary = summarizeLearningTargetStats(targets, stats);
check('同一target IDと同一代表stat参照を重複除外', entries.length === 6, entries);
check(
  '補助Answer統計をセット集約へ二重加算しない',
  selectedStats.length === 5
    && !selectedStats.some((value) => value.targetType === 'answer' && value.targetId === 'answer-1'),
  selectedStats,
);
check(
  'Input/Outputを別集約',
  summary.mastery.byMode.input.mastery === 0.9
    && summary.mastery.byMode.output.attempts === 11
    && summary.mastery.byMode.output.correctCount === 5,
  summary.mastery.byMode,
);
check(
  'ContextはExercise成績だけで集約',
  summary.mastery.byMode.context.attempts === 4
    && summary.mastery.byMode.context.mastery === 0.625,
  summary.mastery.byMode.context,
);
check(
  'CompositionはExercise成績だけで集約',
  summary.mastery.byMode.composition.attempts === 2
    && summary.mastery.byMode.composition.mastery === 0,
  summary.mastery.byMode.composition,
);
check(
  '苦手・未出題Learning Targetを重複なく集計',
  summary.totalTargetCount === 6
    && summary.attemptedCount === 5
    && summary.unattemptedCount === 1
    && summary.weakCount === 2,
  summary,
);
check(
  '画面用の苦手・未出題項目数はSense単位で重複除外',
  summary.totalSenseCount === 2
    && summary.attemptedSenseCount === 1
    && summary.unattemptedSenseCount === 1
    && summary.weakSenseCount === 1,
  summary,
);

console.log(failures === 0 ? '\n🎉 ALL PASS (memory selectors)' : `\n💥 ${failures} FAILURES (memory selectors)`);
process.exit(failures === 0 ? 0 : 1);
