import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifyMemoryCard } from '../src/features/memory/application/verification';
import { buildMemorySetCardRows } from '../src/features/memory/domain/cardRows';
import { generateLearningTargets } from '../src/features/memory/domain/selectors';
import type { MemoryContentBundle, MemorySetBundle } from '../src/features/memory/domain/types';
import type { MemoryRepository } from '../src/features/memory/infrastructure/repositories';

const now = '2026-07-21T00:00:00.000Z';
const content: MemoryContentBundle = {
  items: [{ id: 'item-1', kind: 'word', label: '日本語だけの壊れた見出し', tags: [], source: 'ai', verificationStatus: 'unverified_ai', createdAt: now, updatedAt: now, revision: 1 }],
  senses: [
    { id: 'sense-1', itemId: 'item-1', promptJa: '引き出す', meaningJa: '引き出す', siblingGroupId: 'sibling-1', tags: [], source: 'ai', verificationStatus: 'unverified_ai', createdAt: now, updatedAt: now, revision: 1 },
    { id: 'sense-2', itemId: 'item-1', promptJa: '意識', meaningJa: '意識', siblingGroupId: 'sibling-1', tags: [], source: 'ai', verificationStatus: 'unverified_ai', createdAt: now, updatedAt: now, revision: 1 },
  ],
  answers: [
    { id: 'answer-1', senseId: 'sense-1', displayForm: 'tap into', citationForm: 'tap into', acceptedVariants: [], orthographicVariants: [], source: 'ai', verificationStatus: 'unverified_ai', createdAt: now, updatedAt: now, revision: 1 },
    { id: 'answer-2', senseId: 'sense-2', displayForm: 'awareness', citationForm: 'awareness', acceptedVariants: [], orthographicVariants: [], source: 'ai', verificationStatus: 'unverified_ai', createdAt: now, updatedAt: now, revision: 1 },
  ],
  examples: [{ id: 'example-1', senseId: 'sense-1', answerId: 'answer-1', english: 'The program helps students tap into their creativity.', japanese: 'そのプログラムは創造性を引き出す助けになる。', source: 'ai', verificationStatus: 'unverified_ai', createdAt: now, updatedAt: now, revision: 1 }],
  exercises: [],
};

let saved: Parameters<MemoryRepository['saveEntities']>[0] = [];
const repository = {
  loadContent: async () => content,
  saveEntities: async (entities: Parameters<MemoryRepository['saveEntities']>[0]) => { saved = entities; },
} as unknown as MemoryRepository;

const count = await verifyMemoryCard(repository, 'item-1', 'sense-1');
assert.equal(count, 4, '親Itemと選択Sense・Answer・Exampleだけを確認済みにする');
assert.deepEqual(saved.map((entry) => entry.entityId).sort(), ['answer-1', 'example-1', 'item-1', 'sense-1']);
assert.equal(saved.some((entry) => entry.entityId === 'sense-2' || entry.entityId === 'answer-2'), false, '別カードの確認状態を勝手に変更しない');
assert.equal(saved.every((entry) => (entry.value as { verificationStatus?: string }).verificationStatus === 'verified'), true);

const bundle: MemorySetBundle = {
  ...content,
  sets: [{ id: 'set-1', name: '英語', tags: [], createdAt: now, updatedAt: now, revision: 1 }],
  setMembers: [{ setId: 'set-1', itemId: 'item-1', order: 0, createdAt: now }],
};
const rows = buildMemorySetCardRows(bundle);
assert.equal(rows.length, 2, '旧データの複数Senseも2枚の表示カードへ分ける');
assert.deepEqual(rows.map((row) => row.japanese), ['引き出す', '意識']);
assert.deepEqual(rows.map((row) => row.englishForms), [['tap into'], ['awareness']]);
assert.equal(rows[0].examples[0]?.japanese, 'そのプログラムは創造性を引き出す助けになる。');

const verifiedBundle: MemorySetBundle = {
  ...bundle,
  items: bundle.items.map((item) => ({ ...item, verificationStatus: 'verified' as const })),
  senses: bundle.senses.map((sense) => ({ ...sense, verificationStatus: 'verified' as const })),
  answers: bundle.answers.map((answer) => ({ ...answer, verificationStatus: 'verified' as const })),
  examples: bundle.examples.map((example) => ({ ...example, verificationStatus: 'verified' as const })),
};
const targets = generateLearningTargets({ content: verifiedBundle, setMembers: verifiedBundle.setMembers, selectedSetIds: ['set-1'], direction: 'input' });
assert.equal(targets.length, 2, '壊れたItem labelではなくSenseごとの英語Answerで英→日問題を作れる');

const detailSource = await readFile(new URL('../src/features/memory/ui/MemorySetDetail.tsx', import.meta.url), 'utf8');
assert.match(detailSource, /buildMemorySetCardRows\(bundle\)/u, '一覧は共通のSense単位selectorを使う');
assert.match(detailSource, /key=\{row\.senseId\}/u, '各表示カードをSense IDで分離する');
assert.doesNotMatch(detailSource, /senses\.map\(\(sense\) => sense\.promptJa\)\.join/u, '複数の日本語を1枚へ連結しない');
assert.match(detailSource, /row\.examples\.map[\s\S]*example\.english[\s\S]*example\.japanese/u, '例文と和訳を対応するカード内に表示する');
assert.match(detailSource, /verifyMemoryCard\(repository, itemId, senseId\)/u, '確認マークは表示中の1カードを確認する');

const studySource = await readFile(new URL('../src/features/memory/ui/MemoryStudy.tsx', import.meta.url), 'utf8');
assert.match(studySource, /const englishAnswers = uniqueDisplayAnswers\(answers\.map/u, '英語側はAnswerレコードから作る');
assert.match(studySource, /target\.mode === 'input' \? englishAnswers\[0\] \?\? item\.label : sense\.promptJa/u, '英→日でAnswerをItem labelより優先する');
assert.match(studySource, /const japaneseAnswers = uniqueDisplayAnswers\(\[sense\.promptJa, sense\.meaningJa\]\)/u, '日本語側はSenseから作る');
assert.match(studySource, /const questionExample = target\.mode === 'input' \? example\?\.english : example\?\.japanese/u, '例文を出題方向に応じて問題面でも利用する');
assert.match(studySource, /memory-question-example/u, '問題面へ例文コンテキストを表示する');

console.log('✅ memory cards stay one Sense per row, preserve language direction, use examples, and verify precisely');
