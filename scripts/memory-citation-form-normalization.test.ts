import assert from 'node:assert/strict';
import { saveMemoryItemDraft, type MemoryItemDraft } from '../src/features/memory/application/editContent';
import { saveNewMemoryItemCards } from '../src/features/memory/application/saveMemoryItemCards';
import {
  languageIssuesForMemoryEntity,
  normalizeEnglishCitationForm,
} from '../src/features/memory/domain/cardIntegrity';
import type { MemoryContentBundle } from '../src/features/memory/domain/types';
import type { MemoryRepository } from '../src/features/memory/infrastructure/repositories';

const now = '2026-07-23T00:00:00.000Z';
const original: MemoryContentBundle = {
  items: [{
    id: 'item-appalled',
    kind: 'word',
    label: 'appalled',
    lemma: 'appalled',
    tags: [],
    source: 'user',
    verificationStatus: 'verified',
    createdAt: now,
    updatedAt: now,
    revision: 1,
  }],
  senses: [{
    id: 'sense-appalled',
    itemId: 'item-appalled',
    promptJa: '唖然とした',
    meaningJa: '唖然とした',
    siblingGroupId: 'sibling-appalled',
    tags: [],
    source: 'user',
    verificationStatus: 'verified',
    createdAt: now,
    updatedAt: now,
    revision: 1,
  }],
  answers: [{
    id: 'answer-appalled',
    senseId: 'sense-appalled',
    displayForm: 'appalled',
    citationForm: '唖然とした',
    acceptedVariants: [],
    orthographicVariants: [],
    source: 'user',
    verificationStatus: 'verified',
    createdAt: now,
    updatedAt: now,
    revision: 1,
  }],
  examples: [],
  exercises: [],
};

let saved: Parameters<MemoryRepository['saveEntities']>[0] = [];
let saveCalls = 0;
const repository = {
  saveEntities: async (entities: Parameters<MemoryRepository['saveEntities']>[0]) => {
    saveCalls += 1;
    saved = entities;
  },
} as unknown as MemoryRepository;

function savedValue(entityType: string, entityId?: string): Record<string, unknown> {
  const entry = saved.find((candidate) => candidate.entityType === entityType
    && (!entityId || candidate.entityId === entityId));
  assert.ok(entry, `${entityType}${entityId ? ` ${entityId}` : ''} must be saved`);
  return entry.value as Record<string, unknown>;
}

assert.equal(normalizeEnglishCitationForm('appalled', '唖然とした'), 'appalled', '日本語だけのhidden基本形を表示中の英語へ戻す');
assert.equal(normalizeEnglishCitationForm('be appalled at A', 'appall'), 'appall', '英字を含む明示的な基本形は維持する');
assert.equal(normalizeEnglishCitationForm('appalled', ''), 'appalled', '空の基本形も表示中の英語へfallbackする');

const editedDraft: MemoryItemDraft = {
  id: 'item-appalled',
  kind: 'word',
  label: 'appalled',
  lemma: 'appalled',
  senses: [{
    id: 'sense-appalled',
    siblingGroupId: 'sibling-appalled',
    promptJa: '唖然とした',
    meaningJa: '唖然とした',
    answers: [{
      id: 'answer-appalled',
      displayForm: 'appalled',
      citationForm: '唖然とした',
    }],
    examples: [],
  }],
};

await saveMemoryItemDraft({ repository, draft: editedDraft, original });
assert.equal(saveCalls, 1, '既存カードの修復を1 transactionで保存する');
const editedAnswer = savedValue('answer', 'answer-appalled');
assert.equal(editedAnswer.displayForm, 'appalled');
assert.equal(editedAnswer.citationForm, 'appalled', '編集画面に出ない日本語citationFormを修復する');
assert.equal(languageIssuesForMemoryEntity('answer', editedAnswer).length, 0, '修復後は共有validatorを通過する');

saved = [];
await saveMemoryItemDraft({
  repository,
  original,
  draft: {
    ...editedDraft,
    senses: [{
      ...editedDraft.senses[0],
      answers: [{
        id: 'answer-appalled',
        displayForm: 'be appalled at A',
        citationForm: 'appall',
      }],
    }],
  },
});
assert.equal(savedValue('answer', 'answer-appalled').citationForm, 'appall', '有効なcitationFormを上書きしない');

saved = [];
await saveNewMemoryItemCards({
  repository,
  setId: 'set-english',
  setOrder: 4,
  draft: {
    kind: 'expression',
    senses: [{
      promptJa: '唖然とした',
      answers: [
        { displayForm: 'appalled', citationForm: '唖然とした' },
        { displayForm: 'be appalled at A', citationForm: 'appall' },
      ],
      examples: [],
    }],
  },
});
const newAnswers = saved
  .filter((entry) => entry.entityType === 'answer')
  .map((entry) => entry.value as Record<string, unknown>);
assert.deepEqual(newAnswers.map((answer) => answer.citationForm), ['appalled', 'appall'], '新規追加でも各Answerを独立して正規化する');
assert.equal(newAnswers.every((answer) => languageIssuesForMemoryEntity('answer', answer).length === 0), true);
const newItem = savedValue('item');
assert.equal(newItem.label, 'appalled', '新規Itemの見出しへ日本語citationFormを流さない');
assert.equal(newItem.lemma, 'appalled', '新規Itemのlemmaへ日本語citationFormを流さない');

const invalidEnglish = normalizeEnglishCitationForm('唖然とした', '唖然とした');
assert.equal(invalidEnglish, '唖然とした');
assert.equal(languageIssuesForMemoryEntity('answer', {
  displayForm: invalidEnglish,
  citationForm: invalidEnglish,
}).length, 2, '表示中の英語自体が日本語だけならvalidatorは従来どおり拒否する');

console.log('✅ hidden invalid citationForm falls back to visible English without weakening language validation');
