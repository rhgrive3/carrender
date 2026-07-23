import assert from 'node:assert/strict';
import { saveMemoryItemDraft, type MemoryItemDraft } from '../src/features/memory/application/editContent';
import { languageIssuesForMemoryEntity } from '../src/features/memory/domain/cardIntegrity';
import type { MemoryContentBundle } from '../src/features/memory/domain/types';
import type { MemoryRepository } from '../src/features/memory/infrastructure/repositories';

const now = '2026-07-23T02:30:00.000Z';
const base: MemoryContentBundle = {
  items: [{
    id: 'item-awareness',
    kind: 'word',
    label: '日本語だけの壊れた見出し',
    lemma: '意識',
    tags: [],
    source: 'user',
    verificationStatus: 'verified',
    createdAt: now,
    updatedAt: now,
    revision: 1,
  }],
  senses: [{
    id: 'sense-awareness',
    itemId: 'item-awareness',
    promptJa: '意識',
    meaningJa: '意識',
    siblingGroupId: 'sibling-awareness',
    tags: [],
    source: 'user',
    verificationStatus: 'verified',
    createdAt: now,
    updatedAt: now,
    revision: 1,
  }],
  answers: [{
    id: 'answer-awareness',
    senseId: 'sense-awareness',
    displayForm: 'awareness',
    citationForm: 'awareness',
    acceptedVariants: [],
    orthographicVariants: [],
    source: 'user',
    verificationStatus: 'verified',
    createdAt: now,
    updatedAt: now,
    revision: 1,
  }],
  examples: [{
    id: 'example-awareness',
    senseId: 'sense-awareness',
    answerId: 'answer-awareness',
    english: 'Awareness is the first step toward change.',
    japanese: '意識することが変化への第一歩だ。',
    source: 'user',
    verificationStatus: 'verified',
    createdAt: now,
    updatedAt: now,
    revision: 1,
  }],
  exercises: [],
};

const draft: MemoryItemDraft = {
  id: 'item-awareness',
  kind: 'word',
  label: '日本語だけの壊れた見出し',
  lemma: '意識',
  senses: [{
    id: 'sense-awareness',
    siblingGroupId: 'sibling-awareness',
    promptJa: '意識・認識',
    meaningJa: '意識・認識',
    answers: [{
      id: 'answer-awareness',
      displayForm: 'awareness',
      citationForm: 'awareness',
    }],
    examples: [{
      id: 'example-awareness',
      english: 'Awareness is the first step toward change.',
      japanese: '意識することが変化への第一歩だ。',
      answerId: 'answer-awareness',
    }],
  }],
};

let saved: Parameters<MemoryRepository['saveEntities']>[0] = [];
let calls = 0;
const repository = {
  saveEntities: async (entities: Parameters<MemoryRepository['saveEntities']>[0]) => {
    calls += 1;
    saved = entities;
  },
} as unknown as MemoryRepository;

await saveMemoryItemDraft({ repository, original: base, draft });
assert.equal(calls, 1, '修復をItem・Sense・Answer・Exampleと同じtransactionで保存する');
const item = saved.find((entry) => entry.entityType === 'item')?.value as Record<string, unknown>;
assert.ok(item);
assert.equal(item.label, 'awareness', '日本語だけのhidden labelを現在の英語へ正規化する');
assert.equal(item.lemma, 'awareness', '日本語だけのhidden lemmaも現在の英語へ正規化する');
assert.equal(languageIssuesForMemoryEntity('item', item).length, 0, '正規化後のItemは共有validatorを通過する');
assert.equal((saved.find((entry) => entry.entityType === 'sense')?.value as { promptJa?: string }).promptJa, '意識・認識');
assert.equal((saved.find((entry) => entry.entityType === 'example')?.value as { english?: string }).english, 'Awareness is the first step toward change.');

const customEnglishOriginal: MemoryContentBundle = {
  ...base,
  items: [{ ...base.items[0], label: 'medical vocabulary', lemma: 'medical-vocabulary' }],
};
saved = [];
await saveMemoryItemDraft({
  repository,
  original: customEnglishOriginal,
  draft: { ...draft, label: 'medical vocabulary', lemma: 'medical-vocabulary' },
});
const customItem = saved.find((entry) => entry.entityType === 'item')?.value as Record<string, unknown>;
assert.equal(customItem.label, 'medical vocabulary', '有効な独自英語labelは維持する');
assert.equal(customItem.lemma, 'medical-vocabulary', '有効な独自英語lemmaは維持する');

saved = [];
await saveMemoryItemDraft({
  repository,
  original: base,
  draft: {
    ...draft,
    senses: [{
      ...draft.senses[0],
      answers: [{ id: 'answer-awareness', displayForm: 'be conscious of A', citationForm: 'conscious' }],
    }],
  },
});
const changedItem = saved.find((entry) => entry.entityType === 'item')?.value as Record<string, unknown>;
assert.equal(changedItem.label, 'conscious', '壊れたhidden見出しは新しい有効citationFormへ追従する');
assert.equal(changedItem.lemma, 'conscious');

const invalidItem = {
  ...item,
  label: '意識',
  lemma: '意識',
};
assert.ok(languageIssuesForMemoryEntity('item', invalidItem).length > 0, 'validator自体の英語必須契約は緩めない');

console.log('✅ hidden invalid Item label and lemma normalize to the visible valid English before save');
