import assert from 'node:assert/strict';
import {
  diagnoseLearningTargetEligibility,
  LEARNING_TARGET_EXCLUSION_LABELS,
} from '../src/features/memory/domain/selectors';
import type {
  MemoryAnswer,
  MemoryContentBundle,
  MemoryItem,
  MemorySense,
  MemorySetMember,
} from '../src/features/memory/domain/types';

const now = '2026-07-22T00:00:00.000Z';
const base = {
  source: 'user' as const,
  verificationStatus: 'verified' as const,
  createdAt: now,
  updatedAt: now,
  revision: 1,
};

function item(id: string, overrides: Partial<MemoryItem> = {}): MemoryItem {
  return { ...base, id, kind: 'word', label: `${id} english`, tags: [], ...overrides };
}

function sense(id: string, itemId: string, overrides: Partial<MemorySense> = {}): MemorySense {
  return {
    ...base,
    id,
    itemId,
    promptJa: `${id} 日本語`,
    meaningJa: `${id} 日本語`,
    siblingGroupId: `item:${itemId}`,
    tags: [],
    ...overrides,
  };
}

function answer(id: string, senseId: string, overrides: Partial<MemoryAnswer> = {}): MemoryAnswer {
  return {
    ...base,
    id,
    senseId,
    displayForm: `${id} answer`,
    citationForm: `${id} answer`,
    acceptedVariants: [],
    orthographicVariants: [],
    ...overrides,
  };
}

const items = [
  item('valid'),
  item('missing-en'),
  item('missing-ja'),
  item('unverified', { source: 'ai', verificationStatus: 'unverified_ai' }),
  item('poly'),
];
const senses = [
  sense('valid-sense', 'valid'),
  sense('missing-en-sense', 'missing-en'),
  sense('missing-ja-sense', 'missing-ja', { promptJa: '' }),
  sense('unverified-sense', 'unverified', { source: 'ai', verificationStatus: 'unverified_ai' }),
  sense('poly-a', 'poly'),
  sense('poly-b', 'poly'),
];
const answers = [
  answer('valid-answer', 'valid-sense'),
  answer('unverified-answer', 'unverified-sense', { source: 'ai', verificationStatus: 'unverified_ai' }),
  answer('poly-a-answer', 'poly-a'),
  answer('poly-b-answer', 'poly-b'),
];
const content: MemoryContentBundle = { items, senses, answers, examples: [], exercises: [] };
const members: MemorySetMember[] = [
  ...items.map((value, order) => ({ setId: 'set-1', itemId: value.id, order, createdAt: now })),
  { setId: 'set-1', itemId: 'deleted-parent', order: items.length, createdAt: now },
];

const output = diagnoseLearningTargetEligibility({
  content,
  setMembers: members,
  selectedSetIds: ['set-1'],
  direction: 'output',
  includeUnverifiedAi: false,
});
assert.equal(output.eligibleCount, 3, '有効なoutput Senseだけを出題対象へ数える');
assert.equal(output.counts.missingEnglish, 1, '英語Answerなしを英語未設定へ分類する');
assert.equal(output.counts.missingJapanese, 1, '空の日本語promptを日本語未設定へ分類する');
assert.equal(output.counts.unverifiedAi, 1, '未確認AI親子を一件の理由へ分類する');
assert.equal(output.counts.brokenReference, 1, '存在しない親参照を破損へ分類する');
assert.equal(output.excludedCount, 4, '理由別件数の合計と対象外件数が一致する');
assert.equal(output.candidateCount, output.eligibleCount + output.excludedCount, '候補総数を対象と対象外へ過不足なく分割する');

const input = diagnoseLearningTargetEligibility({
  content,
  setMembers: members,
  selectedSetIds: ['set-1'],
  direction: 'input',
  includeUnverifiedAi: false,
});
assert.equal(input.counts.unsupportedDirection, 2, '多義語で意味を特定する例文がないinputを方向非対応へ分類する');
assert.equal(input.counts.unverifiedAi, 1, '方向変更後も未確認AI理由を維持する');
assert.notDeepEqual(input.counts, output.counts, '出題方向に応じて診断結果が変わる');

const unverifiedIncluded = diagnoseLearningTargetEligibility({
  content,
  setMembers: members,
  selectedSetIds: ['set-1'],
  direction: 'output',
  includeUnverifiedAi: true,
});
assert.equal(unverifiedIncluded.counts.unverifiedAi, 0, '未確認AIを含める設定では除外理由に残さない');
assert.ok(LEARNING_TARGET_EXCLUSION_LABELS.missingEnglish.includes('英語'), '利用者向けラベルをdomainと共有する');

console.log('✅ memory eligibility diagnostic contracts passed');