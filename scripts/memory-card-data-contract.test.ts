import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifyMemoryCard } from '../src/features/memory/application/verification';
import {
  examplesForSense,
  languageIssuesForMemoryEntity,
  primaryEnglishForSense,
} from '../src/features/memory/domain/cardIntegrity';
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
  examples: [
    { id: 'example-1', senseId: 'sense-1', answerId: 'answer-1', english: 'The program helps students tap into their creativity.', japanese: 'そのプログラムは創造性を引き出す助けになる。', source: 'ai', verificationStatus: 'unverified_ai', createdAt: now, updatedAt: now, revision: 1 },
    { id: 'example-2', senseId: 'sense-1', answerId: 'answer-1', english: 'Good teachers tap into curiosity.', japanese: '良い教師は好奇心を引き出す。', source: 'ai', verificationStatus: 'unverified_ai', createdAt: now, updatedAt: now, revision: 1 },
  ],
  exercises: [],
};

assert.equal(languageIssuesForMemoryEntity('answer', { displayForm: '意識', citationForm: '意識' }).length, 2, '英語欄が日本語だけなら保存を拒否する');
assert.equal(languageIssuesForMemoryEntity('answer', { displayForm: 'awareness', citationForm: 'awareness' }).length, 0, '英字を含む英語は保存できる');
assert.equal(primaryEnglishForSense(content, 'sense-1'), 'tap into', '壊れたItem見出しよりSenseのAnswerを優先する');
assert.equal(examplesForSense(content, 'sense-1').length, 2, '同じカードの複数例文を保持する');

let saved: Parameters<MemoryRepository['saveEntities']>[0] = [];
const repository = {
  loadContent: async () => content,
  saveEntities: async (entities: Parameters<MemoryRepository['saveEntities']>[0]) => { saved = entities; },
} as unknown as MemoryRepository;

const count = await verifyMemoryCard(repository, 'item-1', 'sense-1');
assert.equal(count, 5, '親Itemと選択Sense・Answer・複数Exampleだけを確認済みにする');
assert.deepEqual(saved.map((entry) => entry.entityId).sort(), ['answer-1', 'example-1', 'example-2', 'item-1', 'sense-1']);
assert.equal(saved.some((entry) => entry.entityId === 'sense-2' || entry.entityId === 'answer-2'), false, '別カードの確認状態を変更しない');
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
assert.equal(rows[0].examples.length, 2, '一覧でも対応Senseの複数例文を使う');
assert.equal(rows[1].examples.length, 0, '別Senseの例文を混ぜない');

const verifiedBundle: MemorySetBundle = {
  ...bundle,
  items: bundle.items.map((item) => ({ ...item, verificationStatus: 'verified' as const })),
  senses: bundle.senses.map((sense) => ({ ...sense, verificationStatus: 'verified' as const })),
  answers: bundle.answers.map((answer) => ({ ...answer, verificationStatus: 'verified' as const })),
  examples: bundle.examples.map((example) => ({ ...example, verificationStatus: 'verified' as const })),
};
const targets = generateLearningTargets({ content: verifiedBundle, setMembers: verifiedBundle.setMembers, selectedSetIds: ['set-1'], direction: 'output' });
assert.equal(targets.length, 2, '壊れたItem labelではなくSenseごとのAnswerで日→英問題を作る');

const brokenBundle: MemorySetBundle = {
  ...verifiedBundle,
  answers: verifiedBundle.answers.map((answer) => answer.id === 'answer-2'
    ? { ...answer, displayForm: '意識', citationForm: '意識' }
    : answer),
};
const safeTargets = generateLearningTargets({ content: brokenBundle, setMembers: brokenBundle.setMembers, selectedSetIds: ['set-1'], direction: 'output' });
assert.deepEqual(safeTargets.map((target) => target.senseId), ['sense-1'], '日本語が英語欄へ入った既存カードは出題しない');

const detailSource = await readFile(new URL('../src/features/memory/ui/MemorySetDetail.tsx', import.meta.url), 'utf8');
assert.match(detailSource, /buildMemorySetCardRows\(bundle\)/u, '一覧はSense単位selectorを使う');
assert.match(detailSource, /key=\{row\.senseId\}/u, '各表示カードをSense IDで分離する');
assert.doesNotMatch(detailSource, /senses\.map\(\(sense\) => sense\.promptJa\)\.join/u, '複数の日本語を1枚へ連結しない');
assert.match(detailSource, /className="memory-card-verified"[\s\S]*aria-label="確認済み"/u, '確認後も緑のチェックを表示する');
assert.match(detailSource, /className="memory-card-pending"[\s\S]*このカードを確認済みにする/u, '未確認チェックだけを操作にする');

const editorSource = await readFile(new URL('../src/features/memory/ui/MemoryEditor.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(editorSource, /sense\.examples\.length === 0/u, '例文が1件あっても追加操作を隠さない');
assert.match(editorSource, /examples: \[\.\.\.current\.examples, \{ english: '' \}\]/u, '例文を既存配列へ追加する');
assert.match(editorSource, /sanitizeExampleAnswerLinks/u, '別SenseのAnswer参照を例文へ残さない');
assert.match(editorSource, /function compareCreatedRecords[\s\S]*left\.createdAt\.localeCompare\(right\.createdAt\)[\s\S]*left\.id\.localeCompare\(right\.id\)/u, '編集順は作成日時とIDで決定的にする');
assert.match(editorSource, /content\.senses[\s\S]*?\.filter\(\(sense\) => sense\.itemId === item\.id\)[\s\S]*?\.sort\(compareCreatedRecords\)/u, '一覧と同じ順でSenseを編集し、意味番号を入れ替えない');
assert.match(editorSource, /content\.answers[\s\S]*?\.filter\(\(answer\) => answer\.senseId === sense\.id\)[\s\S]*?\.sort\(compareCreatedRecords\)/u, 'Answerの編集順もDB返却順へ依存させない');
assert.match(editorSource, /content\.examples[\s\S]*?\.filter\(\(example\) => example\.senseId === sense\.id\)[\s\S]*?\.sort\(compareCreatedRecords\)/u, '例文の編集順もDB返却順へ依存させない');

const studySource = await readFile(new URL('../src/features/memory/ui/MemoryStudy.tsx', import.meta.url), 'utf8');
assert.match(studySource, /primaryEnglishForSense\(bundle, sense\.id, \{ verifiedOnly: true \}\)/u, '英語側はSenseに属するAnswerから作る');
assert.match(studySource, /examplesForSense\(bundle, sense\.id, \{ verifiedOnly: true \}\)/u, '確認済み例文を全件取得する');
assert.match(studySource, /memory-example-list[\s\S]*examples\.map/u, '答え面に複数例文を表示する');
assert.match(studySource, /memory-question-example/u, '問題面でも方向に合う例文を使う');

console.log('✅ memory cards keep language direction, one Sense per row, persistent verification, stable editing order and multiple examples');
