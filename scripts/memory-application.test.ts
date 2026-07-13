/** Application-level verification for content creation and separated statistics. */
/// <reference types="node" />
import {
  addAnswerToSense,
  buildMemoryCard,
} from '../src/features/memory/application/content';
import { calculateStatUpdates } from '../src/features/memory/application/stats';
import { answerMemoryQuestion, sessionContentIsRestorable } from '../src/features/memory/application/session';
import { saveMemoryItemDraft } from '../src/features/memory/application/editContent';
import { findImportDuplicates, importParsedRows } from '../src/features/memory/application/importContent';
import {
  applyAiImport,
  maximumContentRevision,
  previewAiImport,
} from '../src/features/memory/application/aiImport';
import { createAiContentExport } from '../src/features/memory/domain/importExport';
import type {
  LearningTarget,
  MemoryAnswer,
  MemoryAttempt,
  MemoryContentBundle,
  MemoryExample,
  MemorySession,
  MemorySense,
  MemoryStat,
} from '../src/features/memory/domain/types';
import { createSessionQueue } from '../src/features/memory/domain/sessionQueue';
import { createEmptyStat } from '../src/features/memory/domain/weakness';
import type { MemoryRepository } from '../src/features/memory/infrastructure/repositories';

let failures = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.error(`  ❌ ${name}`, detail ?? '');
  }
}

async function rejects(name: string, action: () => unknown | Promise<unknown>, message: RegExp): Promise<void> {
  try {
    await action();
    check(name, false, 'expected rejection');
  } catch (error) {
    check(name, message.test(error instanceof Error ? error.message : String(error)), error);
  }
}

const now = '2026-07-12T00:00:00.000Z';

console.log('--- Memory application: card construction ---');
{
  const built = buildMemoryCard({
    promptJa: ' 〜を考慮に入れる ',
    answers: [
      { displayForm: ' take A into account ', pattern: 'take {object} into account' },
      { displayForm: 'take account of A', nuance: 'やや形式的' },
      { displayForm: 'allow for A' },
    ],
    tags: [' 入試 ', '入試', '熟語'],
    examples: [{ english: 'Take the delay into account.', japanese: '遅れを考慮しなさい。', answerIndex: 0 }],
    exercises: [{
      type: 'fill_blank',
      prompt: 'Take the delay ( ) account.',
      answerIndex: 0,
      acceptedAnswerIndexes: [0],
      requiredTokens: ['into'],
    }],
    setId: 'set-leap',
  }, now);
  const { items, senses, answers, examples, exercises } = built.bundle;
  check('最小入力からItem/Senseを1件ずつ作成', items.length === 1 && senses.length === 1 && senses[0].itemId === items[0].id, built);
  check('一つのSenseに複数Answerを保持', answers.length === 3 && answers.every((entry) => entry.senseId === senses[0].id), answers);
  check('promptJaはItem直下でなくSenseに保持', senses[0].promptJa === '〜を考慮に入れる' && !('promptJa' in items[0]), { items, senses });
  check('タグをtrim・重複除外', JSON.stringify(items[0].tags) === JSON.stringify(['入試', '熟語']), items[0].tags);
  check('Exampleを指定Answerへ参照接続', examples[0].answerId === answers[0].id, examples[0]);
  check('ExerciseのacceptedAnswerIdsをIDへ変換', exercises[0].answerId === answers[0].id && exercises[0].acceptedAnswerIds[0] === answers[0].id, exercises[0]);
  check('ExerciseはSenseとsibling groupを共有', exercises[0].senseId === senses[0].id && exercises[0].siblingGroupId === senses[0].siblingGroupId, exercises[0]);
  check('セットはコンテンツコピーでなくItem参照', built.setMember?.setId === 'set-leap' && built.setMember.itemId === items[0].id, built.setMember);

  const ai = buildMemoryCard({ promptJa: 'AI意味', answers: [{ displayForm: 'AI answer' }], source: 'ai' }, now);
  check(
    'AI追加は全階層unverified_ai',
    [...ai.bundle.items, ...ai.bundle.senses, ...ai.bundle.answers]
      .every((entry) => entry.source === 'ai' && entry.verificationStatus === 'unverified_ai'),
    ai,
  );
}

await rejects('日本語空欄を拒否', () => buildMemoryCard({ promptJa: ' ', answers: [{ displayForm: 'answer' }] }), /日本語/);
await rejects('Answer空欄を拒否', () => buildMemoryCard({ promptJa: '意味', answers: [{ displayForm: ' ' }] }), /英語表現/);

console.log('--- Memory application: multi-Sense Exercise editor save ---');
{
  let saved: Parameters<MemoryRepository['saveEntities']>[0] = [];
  const repository = {
    saveEntities: async (entities: Parameters<MemoryRepository['saveEntities']>[0]) => { saved = entities; },
  } as unknown as MemoryRepository;
  await saveMemoryItemDraft({
    repository,
    draft: {
      kind: 'construction',
      senses: [
        {
          promptJa: '〜に限定する', answers: [{ displayForm: 'confine O to A' }], examples: [],
          exercises: [{ type: 'fill_blank', prompt: 'His activities were ( ) to school.', answerIndex: 0, acceptedAnswerIndexes: [0], requiredTokens: 'confined' }],
        },
        { promptJa: '閉じ込める', answers: [{ displayForm: 'confine' }], examples: [], exercises: [] },
      ],
    },
  });
  const senses = saved.filter((entry) => entry.entityType === 'sense').map((entry) => entry.value as { siblingGroupId: string });
  const exercise = saved.find((entry) => entry.entityType === 'exercise')?.value as { acceptedAnswerIds: string[]; requiredTokens?: string[]; siblingGroupId: string } | undefined;
  check('Editor保存で同一Itemの全Senseを兄弟化', senses.length === 2 && new Set(senses.map((sense) => sense.siblingGroupId)).size === 1, senses);
  check('Editor保存でExerciseの指定Answerと要求語形を保持', !!exercise && exercise.acceptedAnswerIds.length === 1 && exercise.requiredTokens?.[0] === 'confined' && exercise.siblingGroupId === senses[0]?.siblingGroupId, exercise);
}

console.log('--- Memory application: cascading Sense tombstones ---');
{
  let saved: Parameters<MemoryRepository['saveEntities']>[0] = [];
  const base = { source: 'user' as const, verificationStatus: 'verified' as const, createdAt: now, updatedAt: now, revision: 1 };
  const original: MemoryContentBundle = {
    items: [{ ...base, id: 'item-delete-sense', kind: 'word', label: 'address', tags: [] }],
    senses: [
      { ...base, id: 'sense-keep', itemId: 'item-delete-sense', promptJa: '対処する', meaningJa: '対処する', siblingGroupId: 'item-group', tags: [] },
      { ...base, id: 'sense-remove', itemId: 'item-delete-sense', promptJa: '演説する', meaningJa: '演説する', siblingGroupId: 'item-group', tags: [] },
    ],
    answers: [
      { ...base, id: 'answer-keep', senseId: 'sense-keep', displayForm: 'address', citationForm: 'address', acceptedVariants: [], orthographicVariants: [] },
      { ...base, id: 'answer-remove', senseId: 'sense-remove', displayForm: 'address', citationForm: 'address', acceptedVariants: [], orthographicVariants: [] },
    ],
    examples: [{ ...base, id: 'example-remove', senseId: 'sense-remove', answerId: 'answer-remove', english: 'She addressed the audience.' }],
    exercises: [{ ...base, id: 'exercise-remove', senseId: 'sense-remove', answerId: 'answer-remove', type: 'fill_blank', prompt: 'She ( ) the audience.', acceptedAnswerIds: ['answer-remove'], siblingGroupId: 'item-group' }],
  };
  const repository = {
    saveEntities: async (entities: Parameters<MemoryRepository['saveEntities']>[0]) => { saved = entities; },
  } as unknown as MemoryRepository;
  await saveMemoryItemDraft({
    repository,
    original,
    draft: {
      id: 'item-delete-sense',
      kind: 'word',
      label: 'address',
      senses: [{ id: 'sense-keep', promptJa: '対処する', answers: [{ id: 'answer-keep', displayForm: 'address' }], examples: [], exercises: [] }],
    },
  });
  const deletedIds = new Set(saved.filter((entry) => entry.operation === 'delete').map((entry) => entry.entityId));
  check(
    'Sense削除は子Answer・Example・Exerciseも同時にtombstone化',
    ['sense-remove', 'answer-remove', 'example-remove', 'exercise-remove'].every((id) => deletedIds.has(id)),
    saved,
  );
}

console.log('--- Memory application: unregistered answer registration ---');
{
  let saved: MemoryContentBundle | undefined;
  const repository = {
    saveContentBundle: async (bundle: MemoryContentBundle) => { saved = bundle; },
  } as unknown as MemoryRepository;
  const added = await addAnswerToSense(repository, 'sense-existing', ' consider the fact ', {
    citationForm: 'consider the fact',
    acceptedVariants: ['consider this fact'],
  });
  check('1タップ追加は対象SenseへAnswerを作る', added.senseId === 'sense-existing' && saved?.answers[0].id === added.id, { added, saved });
  check('ユーザー追加Answerはverified', added.source === 'user' && added.verificationStatus === 'verified', added);
}

console.log('--- Memory application: atomic multi-row import grouping ---');
{
  let saved: Parameters<MemoryRepository['saveEntities']>[0] = [];
  const rows = [
    { english: 'take A into account', japanese: '〜を考慮する', tags: [], sourceLine: 1 },
    { english: 'allow for A', japanese: '〜を考慮する', tags: [], sourceLine: 2, example: 'Allow for delays.' },
  ];
  const content: MemoryContentBundle = { items: [], senses: [], answers: [], examples: [], exercises: [] };
  const duplicates = findImportDuplicates(rows, content);
  const repository = {
    loadContent: async () => content,
    listSets: async () => [{ id: 'set-leap', name: 'LEAP', tags: [], createdAt: now, updatedAt: now, revision: 1 }],
    listSetMembers: async () => [],
    saveEntities: async (entities: Parameters<MemoryRepository['saveEntities']>[0]) => { saved = entities; },
  } as unknown as MemoryRepository;
  const resolutions = new Map(duplicates.map((duplicate) => [duplicate.rowIndex, duplicate.suggestedResolution]));
  await importParsedRows({ repository, rows, resolutions, setId: 'set-leap' });
  const itemCreates = saved.filter((entry) => entry.entityType === 'item');
  const senseCreates = saved.filter((entry) => entry.entityType === 'sense');
  const answerCreates = saved.filter((entry) => entry.entityType === 'answer');
  check('同じ日本語の複数行を一つのItem/Senseへ統合', itemCreates.length === 1 && senseCreates.length === 1 && answerCreates.length === 2, saved);
  check('統合行の例文も同一トランザクションへ保持', saved.some((entry) => entry.entityType === 'example'), saved);
}

console.log('--- Memory application: batch polysemy import ---');
{
  let saved: Parameters<MemoryRepository['saveEntities']>[0] = [];
  const rows = [
    { english: 'address', japanese: '〜に対処する', tags: [], sourceLine: 1 },
    { english: 'address', japanese: '演説する', tags: [], sourceLine: 2 },
  ];
  const content: MemoryContentBundle = { items: [], senses: [], answers: [], examples: [], exercises: [] };
  const duplicates = findImportDuplicates(rows, content);
  const repository = {
    loadContent: async () => content,
    listSets: async () => [],
    listSetMembers: async () => [],
    saveEntities: async (entities: Parameters<MemoryRepository['saveEntities']>[0]) => { saved = entities; },
  } as unknown as MemoryRepository;
  await importParsedRows({
    repository,
    rows,
    resolutions: new Map(duplicates.map((duplicate) => [duplicate.rowIndex, duplicate.suggestedResolution])),
  });
  const itemCreates = saved.filter((entry) => entry.entityType === 'item');
  const senseCreates = saved.filter((entry) => entry.entityType === 'sense');
  const answerCreates = saved.filter((entry) => entry.entityType === 'answer');
  check(
    '同じ英語・別日本語の貼付けは一Itemの複数Senseとして保持',
    itemCreates.length === 1 && senseCreates.length === 2 && answerCreates.length === 2,
    saved,
  );
  check(
    '取込した同一Itemの複数Senseは兄弟グループを共有',
    new Set(senseCreates.map((entry) => (entry.value as MemorySense).siblingGroupId)).size === 1,
    senseCreates,
  );
}

console.log('--- Memory application: safe duplicate replacement ---');
{
  const common = {
    source: 'user' as const,
    verificationStatus: 'verified' as const,
    createdAt: now,
    updatedAt: now,
    revision: 4,
  };
  const content: MemoryContentBundle = {
    items: [{
      ...common,
      id: 'item-replace',
      kind: 'expression',
      label: 'take A into account',
      tags: ['old-item-tag'],
    }],
    senses: [{
      ...common,
      id: 'sense-replace',
      itemId: 'item-replace',
      promptJa: '〜を考慮に入れる',
      meaningJa: '〜を考慮に入れる',
      explanation: '既存説明',
      siblingGroupId: 'sibling-replace',
      tags: ['old-sense-tag'],
    }],
    answers: [{
      ...common,
      id: 'answer-replace',
      senseId: 'sense-replace',
      displayForm: 'take A into account',
      citationForm: 'take A into account',
      acceptedVariants: ['take this into account'],
      orthographicVariants: [],
    }],
    examples: [{
      ...common,
      id: 'example-replace',
      senseId: 'sense-replace',
      answerId: 'answer-replace',
      english: 'Take the cost into account.',
      japanese: '費用を考慮しなさい。',
    }],
    exercises: [],
  };
  const replacementRows = [{
    english: 'Take A into account',
    japanese: '〜を考慮に入れる',
    meaning: '事情や事実を判断材料として考慮する',
    example: 'Take the delay into account.',
    tags: ['updated'],
    sourceLine: 7,
  }];
  const replacementDuplicates = findImportDuplicates(replacementRows, content);
  let replacementWrites: Parameters<MemoryRepository['saveEntities']>[0] = [];
  let replacementPreconditions: NonNullable<Parameters<MemoryRepository['saveEntities']>[1]> = [];
  let replacementSaveCalls = 0;
  const replacementRepository = {
    loadContent: async () => content,
    listSets: async () => [],
    listSetMembers: async () => [],
    saveEntities: async (
      entities: Parameters<MemoryRepository['saveEntities']>[0],
      preconditions: NonNullable<Parameters<MemoryRepository['saveEntities']>[1]> = [],
    ) => {
      replacementWrites = entities;
      replacementPreconditions = preconditions;
      replacementSaveCalls += 1;
    },
  } as unknown as MemoryRepository;
  check('置換可能なのは一意な既存Sense/Answer組だけ', replacementDuplicates[0]?.canReplace === true, replacementDuplicates);
  await importParsedRows({
    repository: replacementRepository,
    rows: replacementRows,
    resolutions: new Map([[0, 'replace']]),
    requireExplicitDuplicateResolution: true,
    reviewedDuplicates: replacementDuplicates,
  });
  const senseWrite = replacementWrites.find((entry) => entry.entityType === 'sense');
  const answerWrite = replacementWrites.find((entry) => entry.entityType === 'answer');
  const exampleWrite = replacementWrites.find((entry) => entry.entityType === 'example');
  const updatedSense = senseWrite?.value as MemorySense | undefined;
  const updatedAnswer = answerWrite?.value as MemoryAnswer | undefined;
  const updatedExample = exampleWrite?.value as MemoryExample | undefined;
  check(
    '置換は一括保存1回で既存Senseの意味・タグを同一ID更新',
    replacementSaveCalls === 1
      && senseWrite?.operation === 'update'
      && senseWrite.baseRevision === 4
      && updatedSense?.id === 'sense-replace'
      && updatedSense.itemId === 'item-replace'
      && updatedSense.meaningJa === '事情や事実を判断材料として考慮する'
      && updatedSense.tags[0] === 'updated'
      && updatedSense.revision === 5,
    replacementWrites,
  );
  check(
    '置換はAnswerの親・既存variantを保ったままrevision更新',
    answerWrite?.operation === 'update'
      && answerWrite.baseRevision === 4
      && updatedAnswer?.id === 'answer-replace'
      && updatedAnswer.senseId === 'sense-replace'
      && updatedAnswer.displayForm === 'Take A into account'
      && updatedAnswer.acceptedVariants[0] === 'take this into account'
      && updatedAnswer.revision === 5,
    answerWrite,
  );
  check(
    '置換対象に一意な既存例文があれば同一ID更新',
    exampleWrite?.operation === 'update'
      && exampleWrite.baseRevision === 4
      && updatedExample?.id === 'example-replace'
      && updatedExample.answerId === 'answer-replace'
      && updatedExample.english === 'Take the delay into account.'
      && updatedExample.revision === 5,
    exampleWrite,
  );
  check(
    '有効な置換でItem/Sense/Answerを新規作成しない',
    !replacementWrites.some((entry) => ['item', 'sense', 'answer'].includes(entry.entityType) && entry.operation === 'create'),
    replacementWrites,
  );
  check(
    '重複プレビューで参照した既存レコードを同一transactionの条件に含める',
    ['item-replace', 'sense-replace', 'answer-replace', 'example-replace'].every((id) =>
      replacementPreconditions.some((condition) => condition.key === id && condition.expected !== undefined)),
    replacementPreconditions,
  );

  const noAnswerRows = [{ english: 'allow for A', japanese: '〜を考慮に入れる', tags: [], sourceLine: 11 }];
  const noAnswerDuplicates = findImportDuplicates(noAnswerRows, content);
  let invalidSaveCalls = 0;
  const invalidRepository = {
    loadContent: async () => content,
    listSets: async () => [],
    listSetMembers: async () => [],
    saveEntities: async () => { invalidSaveCalls += 1; },
  } as unknown as MemoryRepository;
  check('Senseだけの重複候補は置換不可と判定', noAnswerDuplicates[0]?.canReplace === false, noAnswerDuplicates);
  await rejects(
    'Answer対象のない置換を新規Itemへ落とさず拒否',
    () => importParsedRows({
      repository: invalidRepository,
      rows: noAnswerRows,
      resolutions: new Map([[0, 'replace']]),
    }),
    /置換先の意味・英語表現を一意に特定できません/,
  );
  check('無効な置換は一件も保存しない', invalidSaveCalls === 0, invalidSaveCalls);

  const ambiguousContent: MemoryContentBundle = {
    ...content,
    answers: [
      ...content.answers,
      { ...content.answers[0], id: 'answer-replace-duplicate' },
    ],
  };
  const ambiguousDuplicates = findImportDuplicates(replacementRows, ambiguousContent);
  let ambiguousSaveCalls = 0;
  const ambiguousRepository = {
    loadContent: async () => ambiguousContent,
    listSets: async () => [],
    listSetMembers: async () => [],
    saveEntities: async () => { ambiguousSaveCalls += 1; },
  } as unknown as MemoryRepository;
  check('同じ意味に同一候補Answerが複数ある場合も置換不可', ambiguousDuplicates[0]?.canReplace === false, ambiguousDuplicates);
  await rejects(
    '複数の置換候補から一件を危険に自動選択しない',
    () => importParsedRows({
      repository: ambiguousRepository,
      rows: replacementRows,
      resolutions: new Map([[0, 'replace']]),
    }),
    /置換先の意味・英語表現を一意に特定できません/,
  );
  check('曖昧な置換は一件も保存しない', ambiguousSaveCalls === 0, ambiguousSaveCalls);

  const ambiguousMergeContent: MemoryContentBundle = {
    ...content,
    items: [
      ...content.items,
      { ...content.items[0], id: 'item-other', label: 'consider A', lemma: 'consider A' },
    ],
    senses: [
      ...content.senses,
      { ...content.senses[0], id: 'sense-other', itemId: 'item-other', siblingGroupId: 'sibling-other' },
    ],
    answers: [
      ...content.answers,
      { ...content.answers[0], id: 'answer-other', senseId: 'sense-other', displayForm: 'consider A', citationForm: 'consider A' },
    ],
  };
  const ambiguousMergeRows = [{ english: 'allow for A', japanese: '〜を考慮に入れる', tags: [], sourceLine: 19 }];
  const ambiguousMergeDuplicates = findImportDuplicates(ambiguousMergeRows, ambiguousMergeContent);
  let ambiguousMergeSaveCalls = 0;
  const ambiguousMergeRepository = {
    loadContent: async () => ambiguousMergeContent,
    listSets: async () => [],
    listSetMembers: async () => [],
    saveEntities: async () => { ambiguousMergeSaveCalls += 1; },
  } as unknown as MemoryRepository;
  check(
    '同じ日本語が複数Itemにある場合は統合先を自動選択しない',
    ambiguousMergeDuplicates[0]?.canMerge === false
      && ambiguousMergeDuplicates[0]?.suggestedResolution !== 'merge',
    ambiguousMergeDuplicates,
  );
  await rejects(
    '曖昧なSenseへの明示的な統合も保存前に拒否',
    () => importParsedRows({
      repository: ambiguousMergeRepository,
      rows: ambiguousMergeRows,
      resolutions: new Map([[0, 'merge']]),
    }),
    /統合先の意味を一意に特定できません/,
  );
  check('曖昧な統合は一件も保存しない', ambiguousMergeSaveCalls === 0, ambiguousMergeSaveCalls);

  let raceSaveCalls = 0;
  const raceRepository = {
    loadContent: async () => content,
    saveEntities: async () => { raceSaveCalls += 1; },
  } as unknown as MemoryRepository;
  await rejects(
    'プレビュー後に出現した重複候補はcommit時に拒否',
    () => importParsedRows({
      repository: raceRepository,
      rows: replacementRows,
      resolutions: new Map(),
      requireExplicitDuplicateResolution: true,
      reviewedDuplicates: [],
    }),
    /重複候補が保存前に変わりました/,
  );
  check('commit時の重複再検証失敗では保存しない', raceSaveCalls === 0, raceSaveCalls);

  let staleSaveCalls = 0;
  const staleContent: MemoryContentBundle = {
    ...content,
    senses: content.senses.map((sense) => ({ ...sense, revision: sense.revision + 1, updatedAt: '2026-07-12T01:00:00.000Z' })),
  };
  const staleRepository = {
    loadContent: async () => staleContent,
    saveEntities: async () => { staleSaveCalls += 1; },
  } as unknown as MemoryRepository;
  await rejects(
    'プレビュー対象のrevision変更もcommit時に拒否',
    () => importParsedRows({
      repository: staleRepository,
      rows: replacementRows,
      resolutions: new Map([[0, 'replace']]),
      requireExplicitDuplicateResolution: true,
      reviewedDuplicates: replacementDuplicates,
    }),
    /重複候補が保存前に変わりました/,
  );
  check('stale置換プレビューでは保存しない', staleSaveCalls === 0, staleSaveCalls);

  let removedSaveCalls = 0;
  const removedRepository = {
    loadContent: async () => ({ items: [], senses: [], answers: [], examples: [], exercises: [] }),
    saveEntities: async () => { removedSaveCalls += 1; },
  } as unknown as MemoryRepository;
  await rejects(
    'プレビュー後に候補が消えた場合も新規Itemへ落とさず拒否',
    () => importParsedRows({
      repository: removedRepository,
      rows: replacementRows,
      resolutions: new Map([[0, 'merge']]),
      requireExplicitDuplicateResolution: true,
      reviewedDuplicates: replacementDuplicates,
    }),
    /重複候補が保存前に変わりました/,
  );
  check('消失した重複候補でも保存しない', removedSaveCalls === 0, removedSaveCalls);
}

console.log('--- Memory application: table-entry provenance ---');
{
  const content: MemoryContentBundle = { items: [], senses: [], answers: [], examples: [], exercises: [] };
  let saved: Parameters<MemoryRepository['saveEntities']>[0] = [];
  const repository = {
    loadContent: async () => content,
    listSets: async () => [],
    listSetMembers: async () => [],
    saveEntities: async (entities: Parameters<MemoryRepository['saveEntities']>[0]) => { saved = entities; },
  } as unknown as MemoryRepository;
  await importParsedRows({
    repository,
    rows: [{ english: 'perceive', japanese: '知覚する', example: 'We perceive light.', tags: [], sourceLine: 1 }],
    resolutions: new Map(),
    source: 'user',
  });
  check(
    '表形式の手入力は作成したItem/Sense/Answer/Exampleをuser由来にできる',
    saved.filter((entry) => ['item', 'sense', 'answer', 'example'].includes(entry.entityType))
      .every((entry) => (entry.value as { source?: string }).source === 'user'),
    saved,
  );
}

console.log('--- Memory application: Sense/Answer/Exercise stat separation ---');
{
  const stats: MemoryStat[] = [];
  const attemptHistory: MemoryAttempt[] = [];
  const repository = {
    getStats: async () => stats,
    getStatTargetAttempts: async (
      targetType: 'sense' | 'answer' | 'exercise',
      targetId: string,
      modeOrLimit: MemoryAttempt['mode'] | number,
      requestedLimit = 50,
    ) => attemptHistory
      .filter((attempt) => (targetType === 'sense' ? attempt.senseId === targetId : targetType === 'answer' ? attempt.answerId === targetId : attempt.exerciseId === targetId)
        && (typeof modeOrLimit === 'number' || attempt.mode === modeOrLimit))
      .slice(-(typeof modeOrLimit === 'number' ? modeOrLimit : requestedLimit))
      .reverse(),
  } as unknown as MemoryRepository;
  const baseAttempt: MemoryAttempt = {
    attemptId: 'attempt-1',
    sessionId: 'session-1',
    clientId: 'client-1',
    itemId: 'item-1',
    senseId: 'sense-1',
    targetId: 'output|sense=sense-1',
    mode: 'output',
    exerciseType: 'typed_output',
    userAnswer: 'allow for A',
    normalizedAnswer: 'allow for a',
    assessment: 'correct',
    errorTypes: [],
    hintUsed: false,
    responseMs: 1200,
    createdAt: now,
  };

  const ordinary = await calculateStatUpdates(repository, { ...baseAttempt, answerId: 'answer-allow-for' });
  const ordinaryKeys = ordinary.updated.map((stat) => `${stat.targetType}:${stat.targetId}:${stat.mode}`).sort();
  check(
    '通常日→英はSenseと実際に出したAnswerだけを更新',
    JSON.stringify(ordinaryKeys) === JSON.stringify([
      'answer:answer-allow-for:output',
      'sense:sense-1:output',
    ]),
    ordinaryKeys,
  );
  check('出さなかった兄弟Answerを正解扱いしない', !ordinary.updated.some((stat) => stat.targetId === 'answer-take-account'), ordinary.updated);

  const inputOnly = await calculateStatUpdates(repository, {
    ...baseAttempt,
    attemptId: 'attempt-input',
    answerId: undefined,
    mode: 'input',
    targetId: 'input|sense=sense-1',
    exerciseType: 'flashcard',
  });
  check('英→日はSenseのInput成績だけを更新', inputOnly.updated.length === 1 && inputOnly.updated[0].targetType === 'sense' && inputOnly.updated[0].mode === 'input', inputOnly.updated);

  const specified = await calculateStatUpdates(repository, {
    ...baseAttempt,
    attemptId: 'attempt-specified',
    answerId: 'answer-required',
    exerciseId: 'exercise-required',
    targetId: 'context|sense=sense-1|answer=answer-required|exercise=exercise-required',
    mode: 'context',
    exerciseType: 'fill_blank',
  });
  check(
    '指定表現Exerciseは指定AnswerとExerciseを評価しSenseへ波及しない',
    specified.updated.some((stat) => stat.targetType === 'answer' && stat.targetId === 'answer-required')
      && specified.updated.some((stat) => stat.targetType === 'exercise' && stat.targetId === 'exercise-required')
      && !specified.updated.some((stat) => stat.targetType === 'sense'),
    specified.updated,
  );

  const existingInput = {
    ...createEmptyStat({ id: 'sense-input', targetType: 'sense' as const, targetId: 'sense-1', mode: 'input' as const, now }),
    attempts: 20,
    correctCount: 19,
    incorrectCount: 1,
  };
  const existingOutput = {
    ...createEmptyStat({ id: 'sense-output', targetType: 'sense' as const, targetId: 'sense-1', mode: 'output' as const, now }),
    attempts: 9,
    correctCount: 3,
    incorrectCount: 6,
  };
  stats.push(existingInput, existingOutput);
  const missedOutput = await calculateStatUpdates(repository, {
    ...baseAttempt,
    attemptId: 'attempt-gap',
    assessment: 'incorrect',
    errorTypes: ['recall'],
    answerId: undefined,
  });
  const senseOutput = missedOutput.updated.find((stat) => stat.targetType === 'sense');
  check('Input高・Output低の方向差を苦手スコアへ反映', !!senseOutput && senseOutput.weaknessScore > 0, senseOutput);
}

console.log('--- Memory application: presented exercise format ---');
{
  const target: LearningTarget = {
    id: 'input|sense=sense-choice',
    mode: 'input',
    itemId: 'item-choice',
    senseId: 'sense-choice',
    exerciseType: 'flashcard',
    siblingGroupId: 'item:item-choice',
    verificationStatus: 'verified',
  };
  const queue = createSessionQueue([target], 'presented-format-seed');
  const session: MemorySession = {
    id: 'session-presented-format',
    status: 'active',
    selectedSetIds: ['set-choice'],
    initialTargetIds: [target.id],
    config: {
      questionCount: { type: 'count', count: 1 },
      direction: 'input',
      includeUnverifiedAi: false,
      preferredExerciseType: 'multiple_choice',
    },
    seed: 'presented-format-seed',
    currentTargetId: queue.currentTargetId,
    queueState: queue,
    completedTargetIds: [],
    needsReviewTargetIds: [],
    answerCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  let persistedAttempt: MemoryAttempt | undefined;
  const repository = {
    getStats: async () => [],
    getStatTargetAttempts: async () => [],
    saveAttempt: async (attempt: MemoryAttempt) => { persistedAttempt = attempt; },
  } as unknown as MemoryRepository;
  const answered = await answerMemoryQuestion({
    repository,
    session,
    assessment: 'correct',
    clientId: 'client-choice',
    responseMs: 900,
    presentedExerciseType: 'multiple_choice',
  });
  check(
    'UIが選択式へ上書きしたInputはAttemptにもmultiple_choiceを記録',
    answered.attempt.exerciseType === 'multiple_choice' && persistedAttempt?.exerciseType === 'multiple_choice',
    { answered: answered.attempt, persistedAttempt },
  );

  const common = {
    source: 'user' as const,
    verificationStatus: 'verified' as const,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
  const baseContent: MemoryContentBundle = {
    items: [{ ...common, id: target.itemId, kind: 'word', label: 'address', tags: [] }],
    senses: [{
      ...common,
      id: target.senseId,
      itemId: target.itemId,
      promptJa: '対処する',
      meaningJa: '対処する',
      siblingGroupId: target.siblingGroupId,
      tags: [],
    }],
    answers: [], examples: [], exercises: [],
  };
  const aiSibling: MemorySense = {
    ...baseContent.senses[0],
    id: 'sense-choice-ai-sibling',
    promptJa: '演説する',
    meaningJa: '演説する',
    source: 'ai',
    verificationStatus: 'unverified_ai',
  };
  const verifiedSibling: MemorySense = {
    ...aiSibling,
    id: 'sense-choice-verified-sibling',
    source: 'user',
    verificationStatus: 'verified',
  };
  check('通常セッション復元では未確認AIの兄弟Senseを無視', sessionContentIsRestorable({ ...baseContent, senses: [...baseContent.senses, aiSibling] }, [target], false));
  check('文脈なしInputは新しい確認済み兄弟Sense追加後に安全に復元拒否', !sessionContentIsRestorable({ ...baseContent, senses: [...baseContent.senses, verifiedSibling] }, [target], false));
  const contextualContent: MemoryContentBundle = {
    ...baseContent,
    senses: [...baseContent.senses, verifiedSibling],
    examples: [{
      ...common,
      id: 'example-choice-context',
      senseId: target.senseId,
      english: 'We need to address this issue.',
    }],
  };
  check('Sense固有の文脈がある多義Inputセッションは復元可能', sessionContentIsRestorable(contextualContent, [target], false));
}

console.log('--- Memory application: AI import apply-time revalidation ---');
{
  const common = {
    source: 'user' as const,
    verificationStatus: 'verified' as const,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
  const content: MemoryContentBundle = {
    items: [{
      ...common,
      id: 'item-ai-revalidation',
      kind: 'expression',
      label: 'take A into account',
      tags: [],
    }],
    senses: [{
      ...common,
      id: 'sense-ai-revalidation',
      itemId: 'item-ai-revalidation',
      promptJa: '〜を考慮に入れる',
      meaningJa: '〜を考慮に入れる',
      siblingGroupId: 'sibling-ai-revalidation',
      tags: [],
    }],
    answers: [{
      ...common,
      id: 'answer-ai-existing',
      senseId: 'sense-ai-revalidation',
      displayForm: 'take A into account',
      citationForm: 'take A into account',
      acceptedVariants: [],
      orthographicVariants: [],
    }],
    examples: [],
    exercises: [{
      ...common,
      id: 'exercise-ai-existing',
      senseId: 'sense-ai-revalidation',
      answerId: 'answer-ai-existing',
      type: 'fill_blank',
      prompt: 'Take the delay ( ) account.',
      acceptedAnswerIds: ['answer-ai-existing'],
      siblingGroupId: 'sibling-ai-revalidation',
    }],
  };
  const newAiAnswer: MemoryAnswer = {
    ...common,
    id: 'answer-ai-new',
    senseId: 'sense-ai-revalidation',
    displayForm: 'allow for A',
    citationForm: 'allow for A',
    acceptedVariants: [],
    orthographicVariants: [],
    source: 'ai',
    verificationStatus: 'unverified_ai',
  };

  const staleDocument = createAiContentExport(content, {
    exportId: 'export-ai-stale-preview',
    baseRevision: maximumContentRevision(content),
    exportedAt: now,
  });
  staleDocument.answers.push(newAiAnswer);
  const stalePreview = previewAiImport(staleDocument, content);
  const newAnswerEntry = stalePreview.entries.find(
    (entry) => entry.entityType === 'answer' && entry.id === newAiAnswer.id && entry.kind === 'new',
  );
  let staleSaveCalls = 0;
  const changedAfterPreview: MemoryContentBundle = {
    ...content,
    items: content.items.map((item) => ({ ...item, label: 'take account of A', revision: item.revision + 1 })),
  };
  const staleRepository = {
    loadContent: async () => changedAfterPreview,
    saveEntities: async () => { staleSaveCalls += 1; },
  } as unknown as MemoryRepository;
  check('AI差分プレビューに新規Answerが現れる', !!newAnswerEntry, stalePreview);
  await rejects(
    '差分確認後にコンテンツが変わった場合は適用を拒否',
    () => applyAiImport({
      repository: staleRepository,
      preview: stalePreview,
      selectedKeys: new Set(newAnswerEntry ? [newAnswerEntry.key] : []),
    }),
    /差分確認後に元データが変更|もう一度差分/,
  );
  check('古いプレビュー拒否時は保存しない', staleSaveCalls === 0, staleSaveCalls);

  const dependentDocument = createAiContentExport(content, {
    exportId: 'export-ai-dependent-selection',
    baseRevision: maximumContentRevision(content),
    exportedAt: now,
  });
  dependentDocument.answers.push(newAiAnswer);
  dependentDocument.exercises = dependentDocument.exercises.map((exercise) => ({
    ...exercise,
    acceptedAnswerIds: [...exercise.acceptedAnswerIds, newAiAnswer.id],
  }));
  const dependentPreview = previewAiImport(dependentDocument, content);
  const changedExerciseEntry = dependentPreview.entries.find(
    (entry) => entry.entityType === 'exercise' && entry.id === 'exercise-ai-existing' && entry.kind === 'changed',
  );
  let dependentSaveCalls = 0;
  const dependentRepository = {
    loadContent: async () => content,
    saveEntities: async () => { dependentSaveCalls += 1; },
  } as unknown as MemoryRepository;
  check('新規Answer参照を含むExercise変更が差分に現れる', !!changedExerciseEntry, dependentPreview);
  await rejects(
    '未選択の新規Answerを参照するExercise変更は適用を拒否',
    () => applyAiImport({
      repository: dependentRepository,
      preview: dependentPreview,
      selectedKeys: new Set(changedExerciseEntry ? [changedExerciseEntry.key] : []),
    }),
    /問題が参照するAnswerも選択/,
  );
  check('参照不足の拒否時は保存しない', dependentSaveCalls === 0, dependentSaveCalls);
}

console.log(failures === 0 ? '\n🎉 ALL PASS (memory application)' : `\n💥 ${failures} FAILURES (memory application)`);
process.exit(failures === 0 ? 0 : 1);
