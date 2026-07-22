import assert from 'node:assert/strict';
import { examplesForSense } from '../src/features/memory/domain/cardIntegrity';
import type { MemoryContentBundle } from '../src/features/memory/domain/types';
import { uniqueDisplayAnswers } from '../src/features/memory/ui/MemoryStudy';

assert.deepEqual(
  uniqueDisplayAnswers([' take care ', 'take care', '', 'look after', null, undefined, 'look after ']),
  ['take care', 'look after'],
  '表示前に前後空白・空値・完全重複を除去する',
);

assert.deepEqual(
  uniqueDisplayAnswers(['US', 'us']),
  ['US', 'us'],
  '大文字小文字が意味を持つ回答は別候補として維持する',
);

const now = '2026-07-22T00:00:00.000Z';
const reviewedBundle: MemoryContentBundle = {
  items: [{
    id: 'item-1', kind: 'word', label: 'immaterial', tags: [], source: 'user',
    verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1,
  }],
  senses: [{
    id: 'sense-1', itemId: 'item-1', promptJa: '実体のない', meaningJa: '実体のない',
    siblingGroupId: 'item:item-1', tags: [], source: 'user', verificationStatus: 'verified',
    createdAt: now, updatedAt: now, revision: 1,
  }],
  answers: [],
  examples: [
    {
      id: 'example-unverified', senseId: 'sense-1', english: 'The distinction is immaterial here.',
      japanese: 'ここではその区別は重要ではない。', source: 'ai', verificationStatus: 'unverified_ai',
      createdAt: now, updatedAt: now, revision: 1,
    },
    {
      id: 'example-verified', senseId: 'sense-1', english: 'His age is immaterial to the decision.',
      japanese: '彼の年齢はその決定には関係ない。', source: 'user', verificationStatus: 'verified',
      createdAt: '2026-07-22T00:00:01.000Z', updatedAt: now, revision: 1,
    },
  ],
  exercises: [],
};

assert.deepEqual(
  examplesForSense(reviewedBundle, 'sense-1', { verifiedOnly: true }).map((example) => example.id),
  ['example-verified', 'example-unverified'],
  'カード本体を確認済みにした後は保存済み例文を答え合わせから失わず、確認済み例文を先に表示する',
);

const unreviewedBundle: MemoryContentBundle = {
  ...reviewedBundle,
  items: [{ ...reviewedBundle.items[0], verificationStatus: 'unverified_ai' }],
  senses: [{ ...reviewedBundle.senses[0], verificationStatus: 'unverified_ai' }],
};
assert.deepEqual(
  examplesForSense(unreviewedBundle, 'sense-1', { verifiedOnly: true }).map((example) => example.id),
  ['example-verified'],
  '未確認カードでは未確認例文を問題表示へ混ぜない',
);

console.log('✅ memory answer and example display normalization regression test passed');
