/** Deterministic adaptive-session queue verification. */
/// <reference types="node" />
import {
  answerCurrentQuestion,
  createSessionQueue,
  currentLearningTarget,
  isValidSessionQueueSnapshot,
  MAX_SESSION_TARGET_ATTEMPTS,
  sessionQueueProgress,
  snapshotSessionQueue,
  undoLastSessionAnswer,
  type SessionQueueState,
} from '../src/features/memory/domain/sessionQueue';
import type { Assessment, LearningTarget } from '../src/features/memory/domain/types';

let failures = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.error(`  ❌ ${name}`, detail ?? '');
  }
}

function target(index: number, siblingGroupId = `group-${index}`): LearningTarget {
  return {
    id: `output|sense=sense-${index}`,
    mode: 'output',
    itemId: `item-${index}`,
    senseId: `sense-${index}`,
    exerciseType: 'flashcard',
    siblingGroupId,
    verificationStatus: 'verified',
  };
}

function answerUntilTarget(
  initial: SessionQueueState,
  targetId: string,
  maximum = 30,
): { state: SessionQueueState; intervening: number } {
  let state = initial;
  let intervening = 0;
  while (state.currentTargetId !== targetId && intervening < maximum) {
    if (!state.currentTargetId) break;
    state = answerCurrentQuestion(state, 'correct').state;
    intervening += 1;
  }
  return { state, intervening };
}

function playSingleTarget(assessments: Assessment[]): SessionQueueState {
  let state = createSessionQueue([target(1)], 'single-target-seed');
  for (const assessment of assessments) {
    if (!state.currentTargetId) break;
    state = answerCurrentQuestion(state, assessment).state;
  }
  return state;
}

console.log('--- Memory session: deterministic initialization and siblings ---');
{
  const targets = [
    target(1, 'group-a'),
    target(2, 'group-a'),
    target(3, 'group-b'),
    target(4, 'group-b'),
  ];
  const first = createSessionQueue([...targets, targets[0]], 'reproducible-seed');
  const second = createSessionQueue([...targets, targets[0]], 'reproducible-seed');
  check('初期Learning Targetを重複除外', first.initialTargetIds.length === targets.length, first.initialTargetIds);
  check('同seed・同対象で初期キューを再現', JSON.stringify(first) === JSON.stringify(second), { first, second });

  const fullOrder = [first.currentTargetId, ...first.queue.map((entry) => entry.targetId)]
    .filter((id): id is string => !!id)
    .map((id) => first.targetsById[id].siblingGroupId);
  check(
    '候補がある限り初期兄弟問題を連続させない',
    fullOrder.every((group, index) => index === 0 || group !== fullOrder[index - 1]),
    fullOrder,
  );
}

console.log('--- Memory session: first answer and retry intervals ---');
{
  const state = createSessionQueue(Array.from({ length: 12 }, (_, index) => target(index)), 'interval-seed');
  const firstTargetId = state.currentTargetId!;
  const firstCorrect = answerCurrentQuestion(state, 'correct');
  check('初回correctで即卒業', firstCorrect.graduated && firstCorrect.state.completedTargetIds.includes(firstTargetId), firstCorrect);
  check('卒業進捗と回答回数を分離', sessionQueueProgress(firstCorrect.state).graduated === 1 && sessionQueueProgress(firstCorrect.state).answerCount === 1, sessionQueueProgress(firstCorrect.state));

  const firstMiss = answerCurrentQuestion(state, 'incorrect');
  check('初回incorrectの予定間隔は4〜7問', (firstMiss.scheduledGap ?? 0) >= 4 && (firstMiss.scheduledGap ?? 0) <= 7, firstMiss);
  check('初回incorrectを直後に再出題しない', firstMiss.state.currentTargetId !== firstTargetId, firstMiss.state);
  const returned = answerUntilTarget(firstMiss.state, firstTargetId);
  check('初回incorrectは予定した4〜7問後に戻る', returned.state.currentTargetId === firstTargetId && returned.intervening === firstMiss.scheduledGap, returned);

  const secondMiss = answerCurrentQuestion(returned.state, 'incorrect');
  check('2回目incorrect後は3〜5問へ短縮', (secondMiss.scheduledGap ?? 0) >= 3 && (secondMiss.scheduledGap ?? 0) <= 5, secondMiss);
  const returnedTwice = answerUntilTarget(secondMiss.state, firstTargetId);
  check('2回目incorrectも直後ではなく予定間隔後', returnedTwice.intervening === secondMiss.scheduledGap, returnedTwice);

  const thirdMiss = answerCurrentQuestion(returnedTwice.state, 'incorrect');
  check('3回目以降incorrect後は2〜4問', (thirdMiss.scheduledGap ?? 0) >= 2 && (thirdMiss.scheduledGap ?? 0) <= 4, thirdMiss);
}

console.log('--- Memory session: two clean recalls after a miss ---');
{
  let state = createSessionQueue(Array.from({ length: 10 }, (_, index) => target(index)), 'graduation-seed');
  const struggledId = state.currentTargetId!;
  const missed = answerCurrentQuestion(state, 'incorrect');
  state = answerUntilTarget(missed.state, struggledId).state;
  const firstRecall = answerCurrentQuestion(state, 'correct');
  check('一度ミスした対象は1回correctでは卒業しない', !firstRecall.graduated && !firstRecall.needsReview, firstRecall);
  check('2回のcorrect間に最低1問を予定', (firstRecall.scheduledGap ?? 0) >= 1, firstRecall);
  const secondOpportunity = answerUntilTarget(firstRecall.state, struggledId);
  check('2回のcorrect間に非兄弟問題を挟む', secondOpportunity.intervening >= 1, secondOpportunity);
  const secondRecall = answerCurrentQuestion(secondOpportunity.state, 'correct');
  check('ミス後の間隔を空けた2連続correctで卒業', secondRecall.graduated && secondRecall.state.completedTargetIds.includes(struggledId), secondRecall);
}

console.log('--- Memory session: max five and tiny pools ---');
{
  const graduatesAtFive = playSingleTarget(['incorrect', 'incorrect', 'incorrect', 'correct', 'correct']);
  check(
    '×××○○は5回目で卒業',
    graduatesAtFive.completedTargetIds.length === 1
      && graduatesAtFive.needsReviewTargetIds.length === 0
      && graduatesAtFive.answerCount === MAX_SESSION_TARGET_ATTEMPTS,
    graduatesAtFive,
  );

  const reviewAtFive = playSingleTarget(['incorrect', 'incorrect', 'incorrect', 'incorrect', 'correct']);
  check(
    '××××○は5回目で要確認',
    reviewAtFive.completedTargetIds.length === 0
      && reviewAtFive.needsReviewTargetIds.length === 1
      && reviewAtFive.answerCount === MAX_SESSION_TARGET_ATTEMPTS
      && reviewAtFive.status === 'completed',
    reviewAtFive,
  );

  const tinyAfterMiss = answerCurrentQuestion(createSessionQueue([target(1)], 'tiny-seed'), 'incorrect').state;
  check(
    '問題数が少なく間隔を確保できなくても停止しない',
    tinyAfterMiss.status === 'active'
      && tinyAfterMiss.currentTargetId === target(1).id
      && tinyAfterMiss.currentSelectionRelaxedInterval,
    tinyAfterMiss,
  );

  const partial = answerCurrentQuestion(createSessionQueue([target(1), target(2), target(3), target(4), target(5), target(6)], 'partial-seed'), 'partial');
  check('初回partialは3〜5問後へ送る', (partial.scheduledGap ?? 0) >= 3 && (partial.scheduledGap ?? 0) <= 5, partial);
  check('partialは完全正解の連続回数へ含めない', partial.state.progressByTargetId[partial.targetId].consecutiveCorrect === 0, partial.state.progressByTargetId[partial.targetId]);
}

console.log('--- Memory session: sibling avoidance, restore and undo ---');
{
  const targets = [target(1, 'same'), target(2, 'same'), target(3, 'different')];
  const state = createSessionQueue(targets, 'sibling-answer-seed');
  const answered = currentLearningTarget(state)!;
  const hasNonSibling = state.queue.some((entry) => state.targetsById[entry.targetId].siblingGroupId !== answered.siblingGroupId);
  const next = answerCurrentQuestion(state, 'incorrect').state;
  const nextTarget = currentLearningTarget(next)!;
  check(
    '直前と同じsiblingGroupを他候補がある限り避ける',
    !hasNonSibling || nextTarget.siblingGroupId !== answered.siblingGroupId,
    { answered, nextTarget },
  );

  const before = snapshotSessionQueue(state);
  const answeredOnce = answerCurrentQuestion(state, 'incorrect').state;
  const undo = undoLastSessionAnswer(answeredOnce);
  check('直前回答を1回取り消せる', undo.didUndo && undo.undoneTargetId === state.currentTargetId, undo);
  check('取消でキュー・卒業・回答回数・乱数状態を完全復元', JSON.stringify(snapshotSessionQueue(undo.state)) === JSON.stringify(before), { before, restored: snapshotSessionQueue(undo.state) });
  check('同じ回答を2回取り消せない', !undoLastSessionAnswer(undo.state).didUndo);
  check('保存用snapshotを妥当と判定', isValidSessionQueueSnapshot(before), before);
  check('壊れたqueue snapshotを拒否', !isValidSessionQueueSnapshot({ ...before, answerCount: 1.5 }));
}

console.log(failures === 0 ? '\n🎉 ALL PASS (memory session)' : `\n💥 ${failures} FAILURES (memory session)`);
process.exit(failures === 0 ? 0 : 1);
