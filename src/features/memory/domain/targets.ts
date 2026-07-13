import type {
  LearningTarget,
  MemoryContentBundle,
  MemoryExercise,
  MemoryMode,
  MemorySessionConfig,
  MemorySetMember,
  MemoryStat,
  MemoryStudyDirection,
} from './types';
import { DEFAULT_MIX_MODE_WEIGHTS, MEMORY_MODES } from './types';
import {
  deterministicShuffle,
  nextRandom,
  seedToRandomState,
} from './seededRandom';
import { masteryForStat, statKey } from './weakness';

function encodeId(value: string): string {
  return encodeURIComponent(value);
}

export function makeLearningTargetId(input: {
  mode: MemoryMode;
  senseId: string;
  answerId?: string;
  exerciseId?: string;
}): string {
  return [
    input.mode,
    `sense=${encodeId(input.senseId)}`,
    input.answerId ? `answer=${encodeId(input.answerId)}` : '',
    input.exerciseId ? `exercise=${encodeId(input.exerciseId)}` : '',
  ].filter(Boolean).join('|');
}

export function modesForDirection(direction: MemoryStudyDirection): MemoryMode[] {
  switch (direction) {
    case 'input': return ['input'];
    case 'output': return ['output'];
    case 'context': return ['context'];
    case 'mix': return [...MEMORY_MODES];
  }
}

function exerciseMode(exercise: MemoryExercise): MemoryMode {
  switch (exercise.type) {
    case 'guided_composition':
    case 'free_composition':
      return 'composition';
    case 'flashcard':
    case 'typed_output':
      return 'output';
    case 'fill_blank':
    case 'reorder':
    case 'multiple_choice':
      return 'context';
  }
}

export interface GenerateLearningTargetsInput {
  content: MemoryContentBundle;
  setMembers: readonly MemorySetMember[];
  selectedSetIds: readonly string[];
  direction: MemoryStudyDirection;
  includeUnverifiedAi?: boolean;
}

/**
 * Builds targets from set references and deduplicates them across selected sets.
 * Deleted parents and unverified AI descendants are excluded as one unit.
 */
export function generateLearningTargets(input: GenerateLearningTargetsInput): LearningTarget[] {
  const includeUnverified = input.includeUnverifiedAi ?? false;
  const selectedSets = new Set(input.selectedSetIds);
  const itemIds = new Set(
    input.setMembers
      .filter((member) => !member.deletedAt && selectedSets.has(member.setId))
      .map((member) => member.itemId),
  );
  const items = new Map(
    input.content.items
      .filter((item) => !item.deletedAt && itemIds.has(item.id))
      .map((item) => [item.id, item]),
  );
  const senses = input.content.senses.filter((sense) => !sense.deletedAt && items.has(sense.itemId));
  const senseMap = new Map(senses.map((sense) => [sense.id, sense]));
  const senseCountByItem = new Map<string, number>();
  for (const sense of senses) {
    const item = items.get(sense.itemId);
    if (!includeUnverified
      && (sense.verificationStatus !== 'verified' || item?.verificationStatus !== 'verified')) continue;
    senseCountByItem.set(sense.itemId, (senseCountByItem.get(sense.itemId) ?? 0) + 1);
  }
  const examplesBySense = new Map<string, typeof input.content.examples>();
  for (const example of input.content.examples) {
    if (example.deletedAt || !senseMap.has(example.senseId)) continue;
    const list = examplesBySense.get(example.senseId) ?? [];
    list.push(example);
    examplesBySense.set(example.senseId, list);
  }
  const answersBySense = new Map<string, typeof input.content.answers>();
  for (const answer of input.content.answers) {
    if (answer.deletedAt || !senseMap.has(answer.senseId)) continue;
    const list = answersBySense.get(answer.senseId) ?? [];
    list.push(answer);
    answersBySense.set(answer.senseId, list);
  }
  const modes = new Set(modesForDirection(input.direction));
  const result = new Map<string, LearningTarget>();

  for (const sense of senses) {
    const item = items.get(sense.itemId);
    if (!item) continue;
    const answers = answersBySense.get(sense.id) ?? [];
    const inputVerified = item.verificationStatus === 'verified' && sense.verificationStatus === 'verified';
    const senseExamples = examplesBySense.get(sense.id) ?? [];
    const usableContextExamples = includeUnverified
      ? senseExamples
      : senseExamples.filter((example) => example.verificationStatus === 'verified');
    // Showing only a polysemous lemma and then grading one Sense is ambiguous.
    // For multi-Sense Items, require an example that identifies the intended
    // Sense. A future item-level "all meanings" exercise can be modelled as an
    // explicit Exercise instead of silently crediting just one Sense.
    const hasUnambiguousInputPrompt = (senseCountByItem.get(item.id) ?? 0) <= 1
      || usableContextExamples.length > 0;
    const inputContextVerified = (senseCountByItem.get(item.id) ?? 0) <= 1
      || usableContextExamples.some((example) => example.verificationStatus === 'verified');
    if (modes.has('input')
      && hasUnambiguousInputPrompt
      && (includeUnverified || (inputVerified && inputContextVerified))) {
      const target: LearningTarget = {
        id: makeLearningTargetId({ mode: 'input', senseId: sense.id }),
        mode: 'input',
        itemId: item.id,
        senseId: sense.id,
        exerciseType: 'flashcard',
        // All modes and Senses belonging to the same Knowledge Item are siblings.
        // This is enforced here as well as in editors so imported legacy data with
        // per-Sense group IDs cannot place related questions back-to-back.
        siblingGroupId: `item:${item.id}`,
        verificationStatus: inputVerified && inputContextVerified ? 'verified' : 'unverified_ai',
      };
      result.set(target.id, target);
    }

    const verifiedAnswers = answers.filter((answer) => answer.verificationStatus === 'verified');
    const usableAnswers = includeUnverified ? answers : verifiedAnswers;
    const outputVerified = inputVerified && usableAnswers.length > 0 && usableAnswers.every(
      (answer) => answer.verificationStatus === 'verified',
    );
    if (modes.has('output') && usableAnswers.length > 0 && (includeUnverified || outputVerified)) {
      const target: LearningTarget = {
        id: makeLearningTargetId({ mode: 'output', senseId: sense.id }),
        mode: 'output',
        itemId: item.id,
        senseId: sense.id,
        exerciseType: 'flashcard',
        siblingGroupId: `item:${item.id}`,
        verificationStatus: outputVerified ? 'verified' : 'unverified_ai',
      };
      result.set(target.id, target);
    }
  }

  for (const exercise of input.content.exercises) {
    if (exercise.deletedAt) continue;
    const sense = senseMap.get(exercise.senseId);
    const item = sense ? items.get(sense.itemId) : undefined;
    if (!sense || !item) continue;
    const mode = exerciseMode(exercise);
    if (!modes.has(mode)) continue;
    const answers = answersBySense.get(sense.id) ?? [];
    const acceptedIds = exercise.acceptedAnswerIds.length > 0
      ? exercise.acceptedAnswerIds
      : exercise.answerId ? [exercise.answerId] : [];
    const acceptedAnswers = acceptedIds.map((id) => answers.find((answer) => answer.id === id));
    if (acceptedIds.length > 0 && acceptedAnswers.some((answer) => !answer)) continue;
    const verified = item.verificationStatus === 'verified'
      && sense.verificationStatus === 'verified'
      && exercise.verificationStatus === 'verified'
      && acceptedAnswers.every((answer) => answer?.verificationStatus === 'verified');
    if (!includeUnverified && !verified) continue;

    const target: LearningTarget = {
      id: makeLearningTargetId({
        mode,
        senseId: sense.id,
        answerId: exercise.answerId,
        exerciseId: exercise.id,
      }),
      mode,
      itemId: item.id,
      senseId: sense.id,
      answerId: exercise.answerId,
      exerciseId: exercise.id,
      exerciseType: exercise.type,
      siblingGroupId: `item:${item.id}`,
      verificationStatus: verified ? 'verified' : 'unverified_ai',
    };
    result.set(target.id, target);
  }

  return [...result.values()];
}

export function automaticQuestionCount(eligibleTargetCount: number): number {
  const count = Math.max(0, Math.floor(eligibleTargetCount));
  if (count < 10) return count;
  return Math.min(count, Math.min(30, Math.max(10, Math.round(count * 0.15))));
}

export function resolveQuestionCount(
  eligibleTargetCount: number,
  questionCount: MemorySessionConfig['questionCount'],
): number {
  const eligible = Math.max(0, Math.floor(eligibleTargetCount));
  switch (questionCount.type) {
    case 'all': return eligible;
    case 'auto': return automaticQuestionCount(eligible);
    case 'weak':
    case 'count': return Math.min(eligible, Math.max(0, Math.floor(questionCount.count)));
  }
}

interface TargetEvidence {
  attempts: number;
  weakness: number;
  directionBoost: number;
  manualWeak: boolean;
}

function evidenceForTarget(
  target: LearningTarget,
  statMap: ReadonlyMap<string, MemoryStat>,
  senseModeStats: ReadonlyMap<string, MemoryStat>,
): TargetEvidence {
  const targetType = target.exerciseId ? 'exercise' : target.answerId ? 'answer' : 'sense';
  const targetId = target.exerciseId ?? target.answerId ?? target.senseId;
  const stat = statMap.get(statKey(targetType, targetId, target.mode));
  let directionBoost = 0;
  if (target.mode === 'output') {
    const input = masteryForStat(senseModeStats.get(`${target.senseId}\u0000input`));
    const output = masteryForStat(senseModeStats.get(`${target.senseId}\u0000output`));
    if (input !== null && output !== null) directionBoost = Math.max(0, input - output) * 40;
  } else if (target.mode === 'context') {
    const output = masteryForStat(senseModeStats.get(`${target.senseId}\u0000output`));
    const context = masteryForStat(senseModeStats.get(`${target.senseId}\u0000context`));
    if (output !== null && context !== null) directionBoost = Math.max(0, output - context) * 40;
  }
  return { attempts: stat?.attempts ?? 0, weakness: stat?.weaknessScore ?? 0, directionBoost, manualWeak: stat?.manualWeak ?? false };
}

function weightedPick<T>(
  candidates: readonly T[],
  weightOf: (candidate: T) => number,
  initialState: number,
): { picked: T; state: number } | null {
  if (candidates.length === 0) return null;
  const weights = candidates.map((candidate) => Math.max(0.0001, weightOf(candidate)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const random = nextRandom(initialState);
  let cursor = random.value * total;
  for (let index = 0; index < candidates.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return { picked: candidates[index], state: random.state };
  }
  return { picked: candidates[candidates.length - 1], state: random.state };
}

function takeWeighted<T>(
  candidates: readonly T[],
  count: number,
  weightOf: (candidate: T) => number,
  initialState: number,
): { picked: T[]; state: number } {
  const pool = [...candidates];
  const picked: T[] = [];
  let state = initialState;
  while (pool.length > 0 && picked.length < count) {
    const selection = weightedPick(pool, weightOf, state);
    if (!selection) break;
    state = selection.state;
    picked.push(selection.picked);
    pool.splice(pool.indexOf(selection.picked), 1);
  }
  return { picked, state };
}

function adaptivePick(
  targets: readonly LearningTarget[],
  count: number,
  statMap: ReadonlyMap<string, MemoryStat>,
  senseModeStats: ReadonlyMap<string, MemoryStat>,
  initialState: number,
): { targets: LearningTarget[]; state: number } {
  if (count >= targets.length) {
    const shuffled = deterministicShuffle(targets, initialState);
    return { targets: shuffled.values, state: shuffled.state };
  }
  const evidence = new Map(targets.map((target) => [target.id, evidenceForTarget(target, statMap, senseModeStats)]));
  const weakCount = Math.min(count, Math.round(count * 0.7));
  const lowEvidenceCount = Math.min(count - weakCount, Math.round(count * 0.2));
  const randomCount = count - weakCount - lowEvidenceCount;
  let state = initialState;

  const weak = takeWeighted(
    targets,
    weakCount,
    (target) => {
      const value = evidence.get(target.id);
      return 1 + (value?.weakness ?? 0) + (value?.directionBoost ?? 0);
    },
    state,
  );
  state = weak.state;
  const pickedIds = new Set(weak.picked.map((target) => target.id));
  const remainingAfterWeak = targets.filter((target) => !pickedIds.has(target.id));
  const low = takeWeighted(
    remainingAfterWeak,
    lowEvidenceCount,
    (target) => Math.max(1, 6 - Math.min(5, evidence.get(target.id)?.attempts ?? 0)),
    state,
  );
  state = low.state;
  low.picked.forEach((target) => pickedIds.add(target.id));
  const remaining = targets.filter((target) => !pickedIds.has(target.id));
  const random = deterministicShuffle(remaining, state);
  state = random.state;
  const selected = [...weak.picked, ...low.picked, ...random.values.slice(0, randomCount)];
  const mixed = deterministicShuffle(selected, state);
  return { targets: mixed.values, state: mixed.state };
}

function weakestPick(
  targets: readonly LearningTarget[],
  count: number,
  statMap: ReadonlyMap<string, MemoryStat>,
  senseModeStats: ReadonlyMap<string, MemoryStat>,
  initialState: number,
): { targets: LearningTarget[]; state: number } {
  const shuffled = deterministicShuffle(targets, initialState);
  const evidence = new Map(shuffled.values.map((target) => [target.id, evidenceForTarget(target, statMap, senseModeStats)]));
  const ranked = [...shuffled.values].sort((left, right) => {
    const a = evidence.get(left.id)!;
    const b = evidence.get(right.id)!;
    return Number(b.manualWeak) - Number(a.manualWeak)
      || (b.weakness + b.directionBoost) - (a.weakness + a.directionBoost)
      || b.attempts - a.attempts;
  });
  return { targets: ranked.slice(0, Math.min(count, ranked.length)), state: shuffled.state };
}

function allocateModeCounts(
  total: number,
  available: Readonly<Record<MemoryMode, number>>,
  weights: Partial<Record<MemoryMode, number>>,
): Record<MemoryMode, number> {
  const result: Record<MemoryMode, number> = { input: 0, output: 0, context: 0, composition: 0 };
  const eligibleModes = MEMORY_MODES.filter((mode) => available[mode] > 0 && (weights[mode] ?? 0) > 0);
  if (total <= 0 || eligibleModes.length === 0) return result;
  let remaining = Math.min(total, eligibleModes.reduce((sum, mode) => sum + available[mode], 0));

  while (remaining > 0) {
    const open = eligibleModes.filter((mode) => result[mode] < available[mode]);
    if (open.length === 0) break;
    const denominator = open.reduce((sum, mode) => sum + Math.max(0, weights[mode] ?? 0), 0);
    if (denominator <= 0) {
      result[open[0]] += 1;
      remaining -= 1;
      continue;
    }
    const shares = open.map((mode) => ({
      mode,
      share: remaining * Math.max(0, weights[mode] ?? 0) / denominator,
    }));
    let assigned = 0;
    for (const entry of shares) {
      const capacity = available[entry.mode] - result[entry.mode];
      const amount = Math.min(capacity, Math.floor(entry.share));
      result[entry.mode] += amount;
      assigned += amount;
    }
    remaining -= assigned;
    if (remaining <= 0) break;
    const ranked = shares
      .filter(({ mode }) => result[mode] < available[mode])
      .sort((left, right) =>
        (right.share - Math.floor(right.share)) - (left.share - Math.floor(left.share))
        || MEMORY_MODES.indexOf(left.mode) - MEMORY_MODES.indexOf(right.mode),
      );
    if (ranked.length === 0) break;
    for (const entry of ranked) {
      if (remaining <= 0) break;
      if (result[entry.mode] >= available[entry.mode]) continue;
      result[entry.mode] += 1;
      remaining -= 1;
    }
  }
  return result;
}

export interface SelectLearningTargetsInput {
  targets: readonly LearningTarget[];
  stats: readonly MemoryStat[];
  count: number;
  seed: string;
  modeWeights?: Partial<Record<MemoryMode, number>>;
  strategy?: 'adaptive' | 'weak';
}

/** 70% weakness, 20% low evidence, 10% random with deterministic weighted draws. */
export function selectLearningTargets(input: SelectLearningTargetsInput): LearningTarget[] {
  const targets = [...new Map(input.targets.map((target) => [target.id, target])).values()];
  const count = Math.min(targets.length, Math.max(0, Math.floor(input.count)));
  if (count === 0) return [];
  const statMap = new Map(input.stats.map((stat) => [statKey(stat.targetType, stat.targetId, stat.mode), stat]));
  const senseModeStats = new Map(
    input.stats
      .filter((stat) => stat.targetType === 'sense')
      .map((stat) => [`${stat.targetId}\u0000${stat.mode}`, stat]),
  );
  let state = seedToRandomState(input.seed);

  const pick = input.strategy === 'weak' ? weakestPick : adaptivePick;
  if (!input.modeWeights) {
    return pick(targets, count, statMap, senseModeStats, state).targets;
  }
  const pools = Object.fromEntries(
    MEMORY_MODES.map((mode) => [mode, targets.filter((target) => target.mode === mode)]),
  ) as unknown as Record<MemoryMode, LearningTarget[]>;
  const available = Object.fromEntries(
    MEMORY_MODES.map((mode) => [mode, pools[mode].length]),
  ) as unknown as Record<MemoryMode, number>;
  const allocations = allocateModeCounts(count, available, input.modeWeights);
  const selected: LearningTarget[] = [];
  for (const mode of MEMORY_MODES) {
    const picked = pick(pools[mode], allocations[mode], statMap, senseModeStats, state);
    state = picked.state;
    selected.push(...picked.targets);
  }
  return deterministicShuffle(selected, state).values;
}

export function selectionModeWeights(config: MemorySessionConfig): Partial<Record<MemoryMode, number>> | undefined {
  if (config.direction !== 'mix') return undefined;
  return config.modeWeights ?? DEFAULT_MIX_MODE_WEIGHTS;
}
