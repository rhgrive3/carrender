import assert from 'node:assert/strict';
import { saveNewMemoryItemCards } from '../src/features/memory/application/saveMemoryItemCards';
import type { MemoryRepository } from '../src/features/memory/infrastructure/repositories';
import type { MemoryAnswer, MemoryExample, MemoryItem, MemorySense, MemorySetMember } from '../src/features/memory/domain/types';

let saveCalls = 0;
let saved: Parameters<MemoryRepository['saveEntities']>[0] = [];
const repository = {
  saveEntities: async (entities: Parameters<MemoryRepository['saveEntities']>[0]) => {
    saveCalls += 1;
    saved = entities;
  },
} as unknown as MemoryRepository;

const itemIds = await saveNewMemoryItemCards({
  repository,
  setId: 'set-english',
  setOrder: 7,
  draft: {
    kind: 'expression',
    senses: [
      {
        promptJa: '逆境に打ち勝つ',
        meaningJa: '逆境に打ち勝つ',
        answers: [{ displayForm: 'beat the odds' }],
        examples: [{ english: 'She beat the odds and became a doctor.', japanese: '彼女は逆境に打ち勝って医師になった。' }],
        exercises: [],
      },
      {
        promptJa: '（物事の）捉え方・見解',
        meaningJa: '（物事の）捉え方・見解',
        answers: [{ displayForm: 'outlook' }],
        examples: [],
        exercises: [],
      },
    ],
  },
});

const items = saved.filter((entry) => entry.entityType === 'item').map((entry) => entry.value as MemoryItem);
const senses = saved.filter((entry) => entry.entityType === 'sense').map((entry) => entry.value as MemorySense);
const answers = saved.filter((entry) => entry.entityType === 'answer').map((entry) => entry.value as MemoryAnswer);
const examples = saved.filter((entry) => entry.entityType === 'example').map((entry) => entry.value as MemoryExample);
const members = saved.filter((entry) => entry.entityType === 'set_member').map((entry) => entry.value as MemorySetMember);

assert.equal(saveCalls, 1, '複数カードは一括トランザクションで保存する');
assert.equal(itemIds.length, 2, '入力したカード数だけItem IDを返す');
assert.equal(new Set(itemIds).size, 2, '各カードは異なるItem IDを持つ');
assert.equal(items.length, 2, '各カードを独立Itemとして作成する');
assert.equal(senses.length, 2, '各ItemにSenseを1件ずつ作成する');
assert.deepEqual(items.map((item) => item.label), ['beat the odds', 'outlook']);
assert.deepEqual(senses.map((sense) => sense.itemId), itemIds, 'Senseを対応する独立Itemへ接続する');
assert.equal(new Set(senses.map((sense) => sense.siblingGroupId)).size, 2, '別カード同士で兄弟グループを共有しない');
assert.deepEqual(answers.map((answer) => answer.senseId), senses.map((sense) => sense.id));
assert.equal(examples[0]?.senseId, senses[0]?.id, '例文を元カードのSenseへ接続する');
assert.equal(examples[0]?.answerId, answers[0]?.id, '英語が1件なら例文をそのAnswerへ接続する');
assert.deepEqual(members.map((member) => member.order), [7, 8], 'セット内の並び順をカードごとに進める');
assert.deepEqual(members.map((member) => member.itemId), itemIds, '各Itemをセットへ個別登録する');

let invalidSaveCalls = 0;
const invalidRepository = {
  saveEntities: async () => { invalidSaveCalls += 1; },
} as unknown as MemoryRepository;
await assert.rejects(
  () => saveNewMemoryItemCards({
    repository: invalidRepository,
    draft: {
      kind: 'expression',
      senses: [
        { promptJa: '有効', answers: [{ displayForm: 'valid' }], examples: [], exercises: [] },
        { promptJa: '英語不足', answers: [{ displayForm: '' }], examples: [], exercises: [] },
      ],
    },
  }),
  /各カードに英語表現/,
  '一部カードが不完全なら保存前に全体を拒否する',
);
assert.equal(invalidSaveCalls, 0, '不完全な複数カードを部分保存しない');

console.log('✅ memory editor separate-card persistence passed');
