/** Deterministic unit verification for the memory domain. */
/// <reference types="node" />
import {
  gradeAnswer,
  gradeInputMeaning,
  inspectCompositionAnswer,
  resolveUnregisteredAnswer,
} from '../src/features/memory/domain/grading';
import {
  damerauLevenshteinDistance,
  matchesAnswerPattern,
  normalizeAnswerText,
} from '../src/features/memory/domain/normalization';
import {
  aggregateMastery,
  applyAttemptToStat,
  computeWeakness,
  createEmptyStat,
  directionGap,
  normalizedResponseTime,
  recentMissScore,
} from '../src/features/memory/domain/weakness';
import {
  automaticQuestionCount,
  generateLearningTargets,
  makeLearningTargetId,
  resolveQuestionCount,
  selectLearningTargets,
} from '../src/features/memory/domain/targets';
import {
  buildAnswerChoiceDistractors,
  buildInputMeaningChoices,
} from '../src/features/memory/domain/studyChoices';
import type {
  LearningTarget,
  MemoryAnswer,
  MemoryContentBundle,
  MemoryExample,
  MemoryExercise,
  MemoryItem,
  MemorySense,
  MemorySetMember,
  MemoryStat,
} from '../src/features/memory/domain/types';

let failures = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.error(`  ❌ ${name}`, detail ?? '');
  }
}

function approximately(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) < 1e-10;
}

const timestamp = '2026-07-12T00:00:00.000Z';
const record = {
  source: 'user' as const,
  verificationStatus: 'verified' as const,
  createdAt: timestamp,
  updatedAt: timestamp,
  revision: 1,
};

function answer(id: string, senseId: string, displayForm: string, over: Partial<MemoryAnswer> = {}): MemoryAnswer {
  return {
    ...record,
    id,
    senseId,
    displayForm,
    citationForm: displayForm,
    acceptedVariants: [],
    orthographicVariants: [],
    ...over,
  };
}

function item(id: string, over: Partial<MemoryItem> = {}): MemoryItem {
  return { ...record, id, kind: 'word', label: id, tags: [], ...over };
}

function sense(id: string, itemId: string, over: Partial<MemorySense> = {}): MemorySense {
  return {
    ...record,
    id,
    itemId,
    promptJa: `${id}の意味`,
    meaningJa: `${id}の意味`,
    siblingGroupId: `siblings:${itemId}`,
    tags: [],
    ...over,
  };
}

function exercise(id: string, senseId: string, over: Partial<MemoryExercise> = {}): MemoryExercise {
  return {
    ...record,
    id,
    senseId,
    type: 'fill_blank',
    prompt: 'Fill in the blank.',
    acceptedAnswerIds: [],
    siblingGroupId: `siblings:${senseId}`,
    ...over,
  };
}

const takeIntoAccount = answer('answer-take', 'sense-consider', 'take A into account', {
  pattern: 'take {object} into account',
  acceptedVariants: ['take it into consideration'],
});
const takeAccountOf = answer('answer-account-of', 'sense-consider', 'take account of A', {
  pattern: 'take account of {object}',
});
const allowFor = answer('answer-allow-for', 'sense-consider', 'allow for A', {
  pattern: 'allow for {object}',
});
const environment = answer('answer-environment', 'sense-environment', 'environment');
const colour = answer('answer-colour', 'sense-colour', 'colour', {
  orthographicVariants: ['color'],
});
const effect = answer('answer-effect', 'sense-effect', 'effect');

console.log('--- Memory: normalization and matching ---');
check(
  'NFKC・大文字小文字・スマートクォート・連続空白・文末句読点を正規化',
  normalizeAnswerText('  ＴＡＫＥ  It  Into  Account。 ') === 'take it into account',
  normalizeAnswerText('  ＴＡＫＥ  It  Into  Account。 '),
);
check('意味を変え得る内部記号は削除しない', normalizeAnswerText('rock-and-roll') === 'rock-and-roll');
check('patternは目的語を含む回答に一致', matchesAnswerPattern('take the delay into account', 'take {object} into account'));
check('patternは目的語欠落を正解にしない', !matchesAnswerPattern('take into account', 'take {object} into account'));
check('Damerau-Levenshteinは隣接転置を1編集と数える', damerauLevenshteinDistance('enviroment', 'environment') === 1);

console.log('--- Memory: answer grading ---');
{
  const exact = gradeAnswer({ userAnswer: 'take A into account', eligibleAnswers: [takeIntoAccount] });
  check('完全一致', exact.assessment === 'correct' && exact.matchKind === 'exact' && exact.matchedAnswerId === takeIntoAccount.id, exact);

  const normalized = gradeAnswer({ userAnswer: ' TAKE   A INTO ACCOUNT. ', eligibleAnswers: [takeIntoAccount] });
  check('大小文字・空白・文末句読点差', normalized.assessment === 'correct' && normalized.matchKind === 'normalized', normalized);

  const accepted = gradeAnswer({ userAnswer: 'take it into consideration', eligibleAnswers: [takeIntoAccount] });
  check('acceptedVariants', accepted.assessment === 'correct' && accepted.matchKind === 'accepted_variant', accepted);

  const orthographic = gradeAnswer({ userAnswer: 'color', eligibleAnswers: [colour] });
  check('英米綴り', orthographic.assessment === 'correct' && orthographic.matchKind === 'orthographic_variant', orthographic);

  const pattern = gradeAnswer({ userAnswer: 'take the circumstances into account', eligibleAnswers: [takeIntoAccount] });
  check('構文pattern', pattern.assessment === 'correct' && pattern.matchKind === 'pattern', pattern);

  const multi = gradeAnswer({
    userAnswer: 'allow for the delay',
    eligibleAnswers: [takeIntoAccount, takeAccountOf, allowFor],
  });
  check('同一Senseの複数自然表現はいずれもSense正解', multi.assessment === 'correct', multi);
  check('実際に出したAnswerだけを特定', multi.matchedAnswerId === allowFor.id, multi);

  const spelling = gradeAnswer({ userAnswer: 'enviroment', eligibleAnswers: [environment] });
  check(
    '軽微なスペル差はpartial候補でありcorrectにしない',
    spelling.assessment === 'partial' && spelling.matchKind === 'spelling_suggestion' && spelling.errorTypes.includes('spelling'),
    spelling,
  );

  const confusable = gradeAnswer({ userAnswer: 'affect', eligibleAnswers: [effect] });
  check(
    'affect/effectをスペルミス扱いしない',
    confusable.assessment === 'incorrect' && confusable.matchKind === 'unregistered' && confusable.needsUserConfirmation,
    confusable,
  );

  const registeredOther = gradeAnswer({
    userAnswer: 'effect',
    eligibleAnswers: [environment],
    allKnownAnswers: [environment, effect],
  });
  check(
    '登録済み別Answerは近似候補より先に文脈不正解',
    registeredOther.assessment === 'incorrect'
      && registeredOther.matchKind === 'registered_other_answer'
      && registeredOther.suggestedAnswerId === effect.id
      && !registeredOther.needsUserConfirmation,
    registeredOther,
  );

  const constrained = gradeAnswer({
    userAnswer: 'take the delay into account',
    eligibleAnswers: [takeIntoAccount],
    exercise: { requiredTokens: ['delay', 'urgently'], forbiddenTokens: ['never'] },
  });
  check(
    '正しい表現でもExercise必須語不足はcontext不正解',
    constrained.assessment === 'incorrect'
      && constrained.errorTypes.includes('context')
      && constrained.missingRequiredTokens.includes('urgently'),
    constrained,
  );

  const forbidden = gradeAnswer({
    userAnswer: 'take the delay into account never',
    eligibleAnswers: [takeIntoAccount],
    exercise: { forbiddenTokens: ['never'] },
  });
  check('禁止語を検出', forbidden.assessment === 'incorrect' && forbidden.presentForbiddenTokens.includes('never'), forbidden);

  const skipped = gradeAnswer({ userAnswer: '   ', eligibleAnswers: [takeIntoAccount] });
  check('空回答はskipped/recall', skipped.assessment === 'skipped' && skipped.errorTypes.includes('recall'), skipped);

  const unknown = gradeAnswer({ userAnswer: 'consider the fact', eligibleAnswers: [takeIntoAccount] });
  check('未登録回答は自動正解にせずユーザー確認', unknown.assessment === 'incorrect' && unknown.needsUserConfirmation, unknown);

  const inputMeaning = gradeInputMeaning({ userAnswer: ' 〜を知覚する。 ', eligibleMeanings: ['〜を知覚する'] });
  check('Input入力式は日本語Senseを正規化判定', inputMeaning.assessment === 'correct', inputMeaning);
  const inputParaphrase = gradeInputMeaning({ userAnswer: '感じ取る', eligibleMeanings: ['〜を知覚する'] });
  check('未登録の日本語言い換えは自動不正解にせず確認', inputParaphrase.needsUserConfirmation, inputParaphrase);

  const wordForm = gradeAnswer({
    userAnswer: 'confine',
    eligibleAnswers: [answer('answer-confine', 'sense-confine', 'confine O to A')],
    exercise: { type: 'fill_blank', requiredTokens: ['confined'] },
  });
  check('穴埋めの見出し形回答を語形partialに分類', wordForm.assessment === 'partial' && wordForm.errorTypes.includes('word_form'), wordForm);
  const inflected = gradeAnswer({
    userAnswer: 'confined',
    eligibleAnswers: [answer('answer-confine-2', 'sense-confine', 'confine O to A')],
    exercise: { type: 'fill_blank', requiredTokens: ['confined'] },
  });
  check('Exercise固有の要求語形を正解判定', inflected.assessment === 'correct', inflected);
}

console.log('--- Memory: user resolution and free composition ---');
check(
  '今回だけ正解はコンテンツ追加なし',
  JSON.stringify(resolveUnregisteredAnswer('accept_once')) === JSON.stringify({ assessment: 'correct', shouldAddAnswer: false }),
);
check(
  '正解表現として登録は正解かつ追加指示',
  JSON.stringify(resolveUnregisteredAnswer('add_answer')) === JSON.stringify({ assessment: 'correct', shouldAddAnswer: true }),
);
check(
  '未登録回答を不正解にできる',
  JSON.stringify(resolveUnregisteredAnswer('reject')) === JSON.stringify({ assessment: 'incorrect', shouldAddAnswer: false }),
);
const composition = inspectCompositionAnswer('I considered this issue.', {
  requiredTokens: ['considered'],
  forbiddenTokens: ['ignored'],
});
check(
  '自由英作文は最終自動採点せず自己評価を要求',
  composition.requiresSelfAssessment === true
    && composition.missingRequiredTokens.length === 0
    && composition.presentForbiddenTokens.length === 0,
  composition,
);

console.log('--- Memory: model/stat separation fixture ---');
{
  const item: MemoryItem = { ...record, id: 'item-perceive', kind: 'word', label: 'perceive', tags: ['LEAP'] };
  const senses: MemorySense[] = [
    { ...record, id: 'sense-perceive-notice', itemId: item.id, promptJa: '気づく', meaningJa: '気づく', siblingGroupId: item.id, tags: [] },
    { ...record, id: 'sense-perceive-understand', itemId: item.id, promptJa: '理解する', meaningJa: '理解する', siblingGroupId: item.id, tags: [] },
  ];
  const answers = [
    answer('answer-perceive-notice', senses[0].id, 'perceive'),
    answer('answer-perceive-understand', senses[1].id, 'perceive'),
  ];
  const stats: MemoryStat[] = [
    {
      id: 'stat-sense-output', targetType: 'sense', targetId: senses[0].id, mode: 'output', attempts: 2,
      correctCount: 1, partialCount: 0, incorrectCount: 1, skippedCount: 0, consecutiveCorrect: 1,
      consecutiveIncorrect: 0, averageResponseMs: 1200, hintCount: 0, manualWeak: false, weaknessScore: 40, updatedAt: timestamp,
    },
    {
      id: 'stat-answer-output', targetType: 'answer', targetId: answers[0].id, mode: 'output', attempts: 1,
      correctCount: 1, partialCount: 0, incorrectCount: 0, skippedCount: 0, consecutiveCorrect: 1,
      consecutiveIncorrect: 0, averageResponseMs: 900, hintCount: 0, manualWeak: false, weaknessScore: 15, updatedAt: timestamp,
    },
    {
      id: 'stat-sense-input', targetType: 'sense', targetId: senses[0].id, mode: 'input', attempts: 10,
      correctCount: 9, partialCount: 0, incorrectCount: 1, skippedCount: 0, consecutiveCorrect: 4,
      consecutiveIncorrect: 0, averageResponseMs: 600, hintCount: 0, manualWeak: false, weaknessScore: 8, updatedAt: timestamp,
    },
  ];
  check('一つのItemに複数Senseを保持', new Set(senses.map((sense) => sense.itemId)).size === 1 && senses.length === 2, senses);
  check('SenseごとにAnswerを保持', answers.every((entry, index) => entry.senseId === senses[index].id), answers);
  check(
    'Sense/AnswerとInput/Outputの統計キーが分離',
    new Set(stats.map((stat) => `${stat.targetType}:${stat.targetId}:${stat.mode}`)).size === stats.length,
    stats,
  );
}

console.log('--- Memory: mastery and weakness ---');
{
  const input = createEmptyStat({ id: 'input', targetType: 'sense', targetId: 'sense-gap', mode: 'input', now: timestamp });
  const output = createEmptyStat({ id: 'output', targetType: 'sense', targetId: 'sense-gap', mode: 'output', now: timestamp });
  const context = createEmptyStat({ id: 'context', targetType: 'sense', targetId: 'sense-gap', mode: 'context', now: timestamp });
  const inputAttempted: MemoryStat = { ...input, attempts: 20, correctCount: 19, incorrectCount: 1 };
  const outputAttempted: MemoryStat = { ...output, attempts: 10, correctCount: 4, incorrectCount: 6 };
  const summary = aggregateMastery([inputAttempted, outputAttempted, context]);
  check(
    'Input/Output/Contextは別習得率',
    summary.byMode.input.mastery === 0.95
      && summary.byMode.output.mastery === 0.4
      && summary.byMode.context.mastery === null,
    summary,
  );
  const expectedOverall = (0.95 * 0.2 + 0.4 * 0.45) / (0.2 + 0.45);
  check('未出題モードは総合習得率の分母から除外', approximately(summary.overall ?? -1, expectedOverall), summary);

  check(
    'Outputのdirection gapはInput-Output',
    approximately(directionGap({ stat: outputAttempted, inputMastery: 0.95, outputMastery: 0.4, contextMastery: null }), 0.55),
  );
  check(
    'Contextのdirection gapはOutput-Context',
    approximately(directionGap({ stat: { ...context, attempts: 5 }, inputMastery: 0.95, outputMastery: 0.4, contextMastery: 0.1 }), 0.3),
  );

  const weakness = computeWeakness({
    stat: outputAttempted,
    attemptsNewestFirst: [
      { assessment: 'incorrect' },
      { assessment: 'correct' },
      { assessment: 'correct' },
      { assessment: 'correct' },
      { assessment: 'correct' },
    ],
    responseContext: { exerciseType: 'typed_output', promptLength: 10, expectedAnswerLength: 20 },
    inputMastery: 0.95,
    outputMastery: 0.4,
  });
  check('苦手スコアは0〜100', weakness.score >= 0 && weakness.score <= 100, weakness);
  check('Input高・Output低をdirection gapへ反映', approximately(weakness.components.directionGap, 0.55), weakness);
  check('回答10回ならlowEvidence加点なし', weakness.components.lowEvidenceScore === 0, weakness);

  const priorAdjusted = computeWeakness({
    stat: createEmptyStat({ id: 'prior', targetType: 'sense', targetId: 'new', mode: 'output', now: timestamp }),
    responseContext: { exerciseType: 'flashcard' },
  });
  check('未回答でも事前値により極端な0%不正解率にしない', priorAdjusted.components.adjustedErrorRate === 1 / 3, priorAdjusted);
  check('未回答は試行不足スコア1', priorAdjusted.components.lowEvidenceScore === 1, priorAdjusted);
  check(
    '直近ミスほど重い',
    recentMissScore([{ assessment: 'incorrect' }, { assessment: 'correct' }])
      > recentMissScore([{ assessment: 'correct' }, { assessment: 'incorrect' }]),
  );
  check(
    '自由英作文は同じ応答時間でカードより遅さペナルティが小さい',
    normalizedResponseTime(12_000, { exerciseType: 'free_composition', promptLength: 20, expectedAnswerLength: 50 })
      < normalizedResponseTime(12_000, { exerciseType: 'flashcard', promptLength: 20, expectedAnswerLength: 50 }),
  );

  const afterCorrect = applyAttemptToStat(output, {
    assessment: 'correct', hintUsed: false, responseMs: 1000, createdAt: timestamp,
  });
  const afterPartial = applyAttemptToStat(afterCorrect, {
    assessment: 'partial', hintUsed: true, responseMs: 3000, createdAt: '2026-07-12T00:00:01.000Z',
  });
  check(
    'partialは完全正解連続回数へ含めない',
    afterPartial.attempts === 2
      && afterPartial.correctCount === 1
      && afterPartial.partialCount === 1
      && afterPartial.consecutiveCorrect === 0,
    afterPartial,
  );
  check('平均応答時間とヒント回数を増分更新', afterPartial.averageResponseMs === 2000 && afterPartial.hintCount === 1, afterPartial);
}

console.log('--- Memory: target generation and selection ---');
{
  const baseItem = item('item-shared', { label: 'consider' });
  const baseSense = sense('sense-shared', baseItem.id);
  const baseAnswer = answer('answer-shared', baseSense.id, 'take A into account');
  const aiItem = item('item-ai', { source: 'ai', verificationStatus: 'unverified_ai' });
  const aiSense = sense('sense-ai', aiItem.id, { source: 'ai', verificationStatus: 'unverified_ai' });
  const aiAnswer = answer('answer-ai', aiSense.id, 'AI expression', {
    source: 'ai', verificationStatus: 'unverified_ai',
  });
  const contextExercise = exercise('exercise-context', baseSense.id, {
    answerId: baseAnswer.id,
    acceptedAnswerIds: [baseAnswer.id],
  });
  const invalidParentExercise = exercise('exercise-orphan-answer', baseSense.id, {
    acceptedAnswerIds: ['answer-does-not-exist'],
  });
  const content: MemoryContentBundle = {
    items: [baseItem, aiItem],
    senses: [baseSense, aiSense],
    answers: [baseAnswer, aiAnswer],
    examples: [],
    exercises: [contextExercise, invalidParentExercise],
  };
  const members: MemorySetMember[] = [
    { setId: 'set-a', itemId: baseItem.id, order: 0, createdAt: timestamp },
    { setId: 'set-b', itemId: baseItem.id, order: 0, createdAt: timestamp },
    { setId: 'set-a', itemId: aiItem.id, order: 1, createdAt: timestamp },
  ];
  const outputTargets = generateLearningTargets({
    content, setMembers: members, selectedSetIds: ['set-a', 'set-b'], direction: 'output',
  });
  check(
    '複数セットで同一Learning Targetを重複除外',
    outputTargets.length === 1 && outputTargets[0].senseId === baseSense.id,
    outputTargets,
  );
  check('未確認AIデータは通常学習から除外', outputTargets.every((target) => target.verificationStatus === 'verified'), outputTargets);
  const withAi = generateLearningTargets({
    content,
    setMembers: members,
    selectedSetIds: ['set-a'],
    direction: 'output',
    includeUnverifiedAi: true,
  });
  check('明示設定時だけ未確認AIを対象化', withAi.some((target) => target.senseId === aiSense.id && target.verificationStatus === 'unverified_ai'), withAi);

  const verifiedDistractorItem = item('item-distractor', { label: 'ignore' });
  const verifiedDistractorSense = sense('sense-distractor', verifiedDistractorItem.id, { promptJa: '無視する' });
  const verifiedDistractorAnswer = answer('answer-distractor', verifiedDistractorSense.id, 'ignore A');
  const sameSenseAlternative = answer('answer-base-alternative', baseSense.id, 'take account of A');
  const answerDistractorContent: MemoryContentBundle = {
    ...content,
    items: [...content.items, verifiedDistractorItem],
    senses: [...content.senses, verifiedDistractorSense],
    answers: [...content.answers, sameSenseAlternative, verifiedDistractorAnswer],
  };
  const verifiedDistractors = buildAnswerChoiceDistractors({
    content: answerDistractorContent,
    senseId: baseSense.id,
    correctAnswers: [baseAnswer, sameSenseAlternative],
    seed: 'choice-seed',
    includeUnverifiedAi: false,
  });
  check(
    '選択式の誤答へ同一Senseと未確認AIを入れない',
    verifiedDistractors.length === 1 && verifiedDistractors[0].id === verifiedDistractorAnswer.id,
    verifiedDistractors,
  );
  const distractorsWithAi = buildAnswerChoiceDistractors({
    content: answerDistractorContent,
    senseId: baseSense.id,
    correctAnswers: [baseAnswer, sameSenseAlternative],
    seed: 'choice-seed',
    includeUnverifiedAi: true,
  });
  check('明示設定時だけ未確認AIを誤答候補へ許可', distractorsWithAi.some((value) => value.id === aiAnswer.id), distractorsWithAi);

  const contextTargets = generateLearningTargets({
    content, setMembers: members, selectedSetIds: ['set-a'], direction: 'context',
  });
  check(
    'Exerciseの文脈に存在するacceptedAnswerIdsだけを対象化',
    contextTargets.length === 1
      && contextTargets[0].exerciseId === contextExercise.id
      && contextTargets[0].answerId === baseAnswer.id,
    contextTargets,
  );

  const polyItem = item('item-poly', { label: 'address' });
  const polySenseA = sense('sense-poly-address', polyItem.id, { promptJa: '対処する' });
  const polySenseB = sense('sense-poly-speech', polyItem.id, { promptJa: '演説する' });
  const polyMember: MemorySetMember = { setId: 'set-poly', itemId: polyItem.id, order: 0, createdAt: timestamp };
  const polyBase: MemoryContentBundle = {
    items: [polyItem], senses: [polySenseA, polySenseB], answers: [], examples: [], exercises: [],
  };
  const ambiguousInput = generateLearningTargets({
    content: polyBase, setMembers: [polyMember], selectedSetIds: ['set-poly'], direction: 'input',
  });
  check('多義語は文脈なしで単一SenseをInput採点しない', ambiguousInput.length === 0, ambiguousInput);
  const contextExample: MemoryExample = {
    ...record,
    id: 'example-poly-address',
    senseId: polySenseA.id,
    english: 'We need to address this issue.',
  };
  const contextualInput = generateLearningTargets({
    content: { ...polyBase, examples: [contextExample] },
    setMembers: [polyMember],
    selectedSetIds: ['set-poly'],
    direction: 'input',
  });
  check(
    '多義語でもSenseを特定する例文付きInputは生成',
    contextualInput.length === 1 && contextualInput[0].senseId === polySenseA.id,
    contextualInput,
  );
  const inputChoiceContent: MemoryContentBundle = {
    ...polyBase,
    items: [...polyBase.items, aiItem, verifiedDistractorItem],
    senses: [...polyBase.senses, aiSense, verifiedDistractorSense],
    answers: [],
    examples: [contextExample],
  };
  const inputChoices = buildInputMeaningChoices({
    content: inputChoiceContent,
    target: contextualInput[0],
    seed: 'input-choice-seed',
    includeUnverifiedAi: false,
  });
  const inputChoicesAgain = buildInputMeaningChoices({
    content: inputChoiceContent,
    target: contextualInput[0],
    seed: 'input-choice-seed',
    includeUnverifiedAi: false,
  });
  check(
    'Input選択式は正解Senseを一つ含み未確認AIを除外',
    inputChoices.length >= 2
      && inputChoices.filter((choice) => choice.correct && choice.senseId === polySenseA.id).length === 1
      && !inputChoices.some((choice) => choice.senseId === aiSense.id),
    inputChoices,
  );
  check('Input選択肢は同seed・同対象で再現', JSON.stringify(inputChoices) === JSON.stringify(inputChoicesAgain), { inputChoices, inputChoicesAgain });

  const alternativeCorrectLabelSense = sense('sense-same-as-correct-meaning', verifiedDistractorItem.id, {
    promptJa: '取り組む',
    meaningJa: '取り組む',
  });
  const currentWithAlternativeMeaning = { ...polySenseA, promptJa: '対処する', meaningJa: '取り組む' };
  const choiceContentWithAliases: MemoryContentBundle = {
    ...inputChoiceContent,
    senses: [currentWithAlternativeMeaning, polySenseB, verifiedDistractorSense, alternativeCorrectLabelSense],
  };
  const aliasSafeChoices = buildInputMeaningChoices({
    content: choiceContentWithAliases,
    target: contextualInput[0],
    seed: 'input-alias-seed',
    includeUnverifiedAi: false,
  });
  check(
    'Input選択肢は正解SenseのpromptJaとmeaningJaをどちらも誤答にしない',
    !aliasSafeChoices.some((choice) => !choice.correct && normalizeAnswerText(choice.label) === normalizeAnswerText('取り組む')),
    aliasSafeChoices,
  );

  const duplicateLabelA = sense('sense-duplicate-a', item('unused-a').id, { promptJa: '除外する' });
  const duplicateLabelB = sense('sense-duplicate-b', item('unused-b').id, { promptJa: '除外する' });
  const orderingItems = [item('unused-a'), item('unused-b')];
  const orderedChoiceContent: MemoryContentBundle = {
    ...inputChoiceContent,
    items: [...inputChoiceContent.items, ...orderingItems],
    senses: [...inputChoiceContent.senses, duplicateLabelA, duplicateLabelB],
  };
  const reversedChoiceContent = { ...orderedChoiceContent, senses: [...orderedChoiceContent.senses].reverse() };
  const choicesInOrder = buildInputMeaningChoices({ content: orderedChoiceContent, target: contextualInput[0], seed: 'stable-dedupe', includeUnverifiedAi: false });
  const choicesReversed = buildInputMeaningChoices({ content: reversedChoiceContent, target: contextualInput[0], seed: 'stable-dedupe', includeUnverifiedAi: false });
  check('Input誤答の重複排除はコンテンツ配列順に依存しない', JSON.stringify(choicesInOrder) === JSON.stringify(choicesReversed), { choicesInOrder, choicesReversed });

  const duplicateAnswerA = answer('answer-duplicate-a', verifiedDistractorSense.id, 'ignore A');
  const anotherDistractorSense = sense('sense-another-distractor', verifiedDistractorItem.id, { promptJa: '無視する別Sense' });
  const duplicateAnswerB = answer('answer-duplicate-b', anotherDistractorSense.id, 'ignore A');
  const answerOrderContent: MemoryContentBundle = {
    ...answerDistractorContent,
    senses: [...answerDistractorContent.senses, anotherDistractorSense],
    answers: [...answerDistractorContent.answers.filter((value) => value.id !== verifiedDistractorAnswer.id), duplicateAnswerA, duplicateAnswerB],
  };
  const distractorsInOrder = buildAnswerChoiceDistractors({ content: answerOrderContent, senseId: baseSense.id, correctAnswers: [baseAnswer], seed: 'stable-answer-dedupe', includeUnverifiedAi: false });
  const distractorsReversed = buildAnswerChoiceDistractors({ content: { ...answerOrderContent, answers: [...answerOrderContent.answers].reverse() }, senseId: baseSense.id, correctAnswers: [baseAnswer], seed: 'stable-answer-dedupe', includeUnverifiedAi: false });
  check('英語誤答の重複排除はコンテンツ配列順に依存しない', JSON.stringify(distractorsInOrder) === JSON.stringify(distractorsReversed), { distractorsInOrder, distractorsReversed });

  const verifiedOnlyItem = item('item-verified-with-ai-sibling', { label: 'plain' });
  const verifiedOnlySense = sense('sense-verified-only', verifiedOnlyItem.id, { promptJa: '明白な' });
  const unverifiedSibling = sense('sense-ai-sibling', verifiedOnlyItem.id, {
    promptJa: '平原', source: 'ai', verificationStatus: 'unverified_ai',
  });
  const verifiedOnlyMember: MemorySetMember = { setId: 'set-policy', itemId: verifiedOnlyItem.id, order: 0, createdAt: timestamp };
  const policyInput = generateLearningTargets({
    content: { items: [verifiedOnlyItem], senses: [verifiedOnlySense, unverifiedSibling], answers: [], examples: [], exercises: [] },
    setMembers: [verifiedOnlyMember], selectedSetIds: ['set-policy'], direction: 'input',
  });
  check(
    '通常学習では未確認AIの兄弟Senseを多義語数へ含めない',
    policyInput.length === 1 && policyInput[0].senseId === verifiedOnlySense.id,
    policyInput,
  );

  check('おまかせはN<10なら全部', automaticQuestionCount(9) === 9);
  check('おまかせは15%かつ10〜30', automaticQuestionCount(100) === 15 && automaticQuestionCount(1000) === 30);
  check('20問は初期Learning Target数をeligible上限で解決', resolveQuestionCount(12, { type: 'count', count: 20 }) === 12);

  const modes = ['output', 'input', 'context', 'composition'] as const;
  const selectionPool: LearningTarget[] = modes.flatMap((mode) =>
    Array.from({ length: 10 }, (_, index) => ({
      id: makeLearningTargetId({ mode, senseId: `${mode}-${index}`, exerciseId: `exercise-${mode}-${index}` }),
      mode,
      itemId: `item-${mode}-${index}`,
      senseId: `${mode}-${index}`,
      exerciseId: `exercise-${mode}-${index}`,
      exerciseType: mode === 'composition' ? 'guided_composition' : mode === 'context' ? 'fill_blank' : 'flashcard',
      siblingGroupId: `siblings-${mode}-${index}`,
      verificationStatus: 'verified',
    })),
  );
  const selected = selectLearningTargets({
    targets: [...selectionPool, selectionPool[0]],
    stats: [],
    count: 10,
    seed: 'mode-ratio-seed',
    modeWeights: { output: 0.5, input: 0.2, context: 0.2, composition: 0.1 },
  });
  const selectedAgain = selectLearningTargets({
    targets: [...selectionPool, selectionPool[0]],
    stats: [],
    count: 10,
    seed: 'mode-ratio-seed',
    modeWeights: { output: 0.5, input: 0.2, context: 0.2, composition: 0.1 },
  });
  const counts = Object.fromEntries(modes.map((mode) => [mode, selected.filter((target) => target.mode === mode).length]));
  check('ミックス初期比率50/20/20/10', counts.output === 5 && counts.input === 2 && counts.context === 2 && counts.composition === 1, counts);
  check('選択結果も重複しない', new Set(selected.map((target) => target.id)).size === selected.length, selected);
  check('同seed・同入力で問題選択を再現', JSON.stringify(selected) === JSON.stringify(selectedAgain), { selected, selectedAgain });

  const noComposition = selectionPool.filter((target) => target.mode !== 'composition');
  const redistributed = selectLearningTargets({
    targets: noComposition,
    stats: [],
    count: 10,
    seed: 'redistribution-seed',
    modeWeights: { output: 0.5, input: 0.2, context: 0.2, composition: 0.1 },
  });
  check('対象がないモードの割合を他モードへ再配分', redistributed.length === 10 && redistributed.every((target) => target.mode !== 'composition'), redistributed);
}

console.log(failures === 0 ? '\n🎉 ALL PASS (memory domain)' : `\n💥 ${failures} FAILURES (memory domain)`);
process.exit(failures === 0 ? 0 : 1);
