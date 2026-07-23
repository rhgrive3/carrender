import assert from 'node:assert/strict';
import { saveMemoryItemDraft, type MemoryItemDraft } from '../src/features/memory/application/editContent';
import { saveNewMemoryItemCards } from '../src/features/memory/application/saveMemoryItemCards';
import {
  memorySenseDraftHasUserContent,
  selectValidMemorySenseDrafts,
} from '../src/features/memory/application/validateMemorySenseDrafts';
import type { MemoryContentBundle } from '../src/features/memory/domain/types';
import type { MemoryRepository } from '../src/features/memory/infrastructure/repositories';

const blankSense = () => ({
  promptJa: '',
  answers: [{ displayForm: '' }],
  examples: [],
});

assert.equal(memorySenseDraftHasUserContent(blankSense()), false, '完全空行は入力済みと扱わない');
assert.equal(memorySenseDraftHasUserContent({ ...blankSense(), answers: [{ displayForm: 'appalled' }] }), true);
assert.equal(memorySenseDraftHasUserContent({ ...blankSense(), meaningJa: '補足の意味' }), true);
assert.equal(memorySenseDraftHasUserContent({ ...blankSense(), explanation: '説明' }), true);
assert.equal(memorySenseDraftHasUserContent({ ...blankSense(), tags: '重要' }), true);
assert.equal(memorySenseDraftHasUserContent({ ...blankSense(), examples: [{ english: 'He was appalled.' }] }), true);
assert.equal(memorySenseDraftHasUserContent({
  ...blankSense(),
  exercises: [{ type: 'translation', prompt: '英訳せよ' }],
}), true);

assert.deepEqual(selectValidMemorySenseDrafts([
  { promptJa: '唖然とした', answers: [{ displayForm: 'appalled' }], examples: [] },
  blankSense(),
], 'カード').map((sense) => sense.promptJa), ['唖然とした'], '完全空の追加行だけを無視する');
assert.throws(
  () => selectValidMemorySenseDrafts([
    { promptJa: '正常', answers: [{ displayForm: 'valid' }], examples: [] },
    { ...blankSense(), answers: [{ displayForm: 'appalled' }] },
  ], 'カード'),
  /カード2に日本語を入力してください/,
);
assert.throws(
  () => selectValidMemorySenseDrafts([{ ...blankSense(), id: 'sense-existing' }], '意味'),
  /意味1の日本語が空です。削除する場合は削除ボタンを使ってください/,
  '既存Senseの空欄化を暗黙削除へ変換しない',
);

let saveCalls = 0;
let savedEntities: Parameters<MemoryRepository['saveEntities']>[0] = [];
const repository = {
  saveEntities: async (entities: Parameters<MemoryRepository['saveEntities']>[0]) => {
    saveCalls += 1;
    savedEntities = entities;
  },
} as unknown as MemoryRepository;

const newDraft: MemoryItemDraft = {
  kind: 'word',
  senses: [
    { promptJa: '有効', answers: [{ displayForm: 'valid' }], examples: [] },
    { promptJa: '', answers: [{ displayForm: 'appalled' }], examples: [] },
  ],
};
await assert.rejects(
  saveNewMemoryItemCards({ repository, draft: newDraft, setId: 'set-1' }),
  /カード2に日本語を入力してください/,
);
assert.equal(saveCalls, 0, '検証失敗時は新規カードを部分保存しない');

const now = '2026-07-23T04:00:00.000Z';
const original: MemoryContentBundle = {
  items: [{
    id: 'item-1', kind: 'word', label: 'first', lemma: 'first', tags: [], source: 'user',
    verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1,
  }],
  senses: [
    {
      id: 'sense-1', itemId: 'item-1', promptJa: '第一', meaningJa: '第一', siblingGroupId: 'siblings',
      tags: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1,
    },
    {
      id: 'sense-2', itemId: 'item-1', promptJa: '第二', meaningJa: '第二', siblingGroupId: 'siblings',
      tags: [], source: 'user', verificationStatus: 'verified', createdAt: '2026-07-23T04:01:00.000Z', updatedAt: now, revision: 1,
    },
  ],
  answers: [
    {
      id: 'answer-1', senseId: 'sense-1', displayForm: 'first', citationForm: 'first', acceptedVariants: [],
      orthographicVariants: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1,
    },
    {
      id: 'answer-2', senseId: 'sense-2', displayForm: 'second', citationForm: 'second', acceptedVariants: [],
      orthographicVariants: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1,
    },
  ],
  examples: [],
  exercises: [],
};

saveCalls = 0;
await assert.rejects(
  saveMemoryItemDraft({
    repository,
    original,
    draft: {
      id: 'item-1', kind: 'word', label: 'first', lemma: 'first', senses: [
        { id: 'sense-1', promptJa: '第一', answers: [{ id: 'answer-1', displayForm: 'first' }], examples: [] },
        { id: 'sense-2', promptJa: '', answers: [{ id: 'answer-2', displayForm: 'second' }], examples: [] },
      ],
    },
  }),
  /意味2の日本語が空です。削除する場合は削除ボタンを使ってください/,
);
assert.equal(saveCalls, 0, '既存Senseの空欄化でもtransactionを開始しない');

saveCalls = 0;
savedEntities = [];
await saveMemoryItemDraft({
  repository,
  original,
  draft: {
    id: 'item-1', kind: 'word', label: 'first', lemma: 'first', senses: [
      { id: 'sense-1', promptJa: '第一', answers: [{ id: 'answer-1', displayForm: 'first' }], examples: [] },
    ],
  },
});
assert.equal(saveCalls, 1, '削除ボタン相当でdraft配列から除去した場合は保存できる');
assert.equal(savedEntities.some((entry) => entry.entityType === 'sense'
  && entry.entityId === 'sense-2'
  && entry.operation === 'delete'), true, '明示削除されたSenseのtombstone契約を維持する');

saveCalls = 0;
const savedIds = await saveNewMemoryItemCards({
  repository,
  setId: 'set-1',
  draft: {
    kind: 'word',
    senses: [
      { promptJa: '第一', answers: [{ displayForm: 'first' }], examples: [] },
      blankSense(),
      { promptJa: '第二', answers: [{ displayForm: 'second' }], examples: [] },
    ],
  },
});
assert.equal(savedIds.length, 2, '完全空行を挟んでも正常な複数カードを保存する');
assert.equal(saveCalls, 1, '正常時は全カードを1 transactionで保存する');

console.log('✅ partial memory cards are rejected before save while truly blank rows remain ignorable');
