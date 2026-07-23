import assert from 'node:assert/strict';
import { saveRoutedMemoryItemDraft } from '../src/features/memory/application/saveRoutedMemoryItemDraft';
import type { MemoryItemDraft } from '../src/features/memory/application/editContent';
import type { MemoryContentBundle } from '../src/features/memory/domain/types';
import type { MemoryRepository } from '../src/features/memory/infrastructure/repositories';

const now = '2026-07-23T17:20:00.000Z';
const original: MemoryContentBundle = {
  items: [
    { id: 'item-a', kind: 'expression', label: 'answer a', lemma: 'answer a', tags: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 },
    { id: 'item-b', kind: 'expression', label: 'answer b', lemma: 'answer b', tags: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 },
  ],
  senses: [
    { id: 'sense-a', itemId: 'item-a', promptJa: '意味A', meaningJa: '意味A', siblingGroupId: 'sibling-a', tags: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 },
  ],
  answers: [
    { id: 'answer-a', senseId: 'sense-a', displayForm: 'answer a', citationForm: 'answer a', acceptedVariants: [], orthographicVariants: [], source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1 },
  ],
  examples: [],
  exercises: [],
};
const draft: MemoryItemDraft = {
  id: 'item-a',
  kind: 'expression',
  label: 'answer a',
  lemma: 'answer a',
  senses: [{
    id: 'sense-a',
    siblingGroupId: 'sibling-a',
    promptJa: '意味A更新',
    meaningJa: '意味A更新',
    answers: [{ id: 'answer-a', displayForm: 'answer a updated' }],
    examples: [],
    exercises: [],
  }],
};

let saveCalls = 0;
let savedItemId: string | undefined;
const repository = {
  saveEntities: async (entities: Parameters<MemoryRepository['saveEntities']>[0]) => {
    saveCalls += 1;
    savedItemId = entities.find((entity) => entity.entityType === 'item')?.entityId;
  },
} as unknown as MemoryRepository;

await assert.rejects(
  saveRoutedMemoryItemDraft({ repository, expectedItemId: 'item-b', draft, original }),
  /カードが切り替わりました/,
  'routeがItem Bへ切り替わった後に残ったItem A draftを保存しない',
);
assert.equal(saveCalls, 0, 'route/draft不一致はtransaction開始前に拒否する');

await assert.rejects(
  saveRoutedMemoryItemDraft({
    repository,
    expectedItemId: 'missing-item',
    draft: { ...draft, id: 'missing-item' },
    original,
  }),
  /カードが切り替わりました/,
  'route Itemが元snapshotに存在しない場合も新規Itemとして保存しない',
);
assert.equal(saveCalls, 0, '存在しないroute Itemでもwriteしない');

await saveRoutedMemoryItemDraft({ repository, expectedItemId: 'item-a', draft, original });
assert.equal(saveCalls, 1, '一致するroute/draftだけを1 transactionで保存する');
assert.equal(savedItemId, 'item-a', 'routeで選択したItem identityを維持する');

console.log('✅ memory edit saves are bound to the route Item identity');
