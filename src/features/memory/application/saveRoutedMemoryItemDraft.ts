import type { MemoryContentBundle } from '../domain/types';
import type { MemoryRepository } from '../infrastructure/repositories';
import { saveMemoryItemDraft, type MemoryItemDraft } from './editContent';

function routedItemIdentityError(): Error {
  return new Error('編集中のカードが切り替わりました。画面を再読み込みしてから保存してください');
}

/**
 * Binds an edit save to the Item selected by the current route. The generic
 * draft saver validates descendant ownership; this boundary additionally
 * prevents a stale draft from being committed after the editor route changes.
 */
export async function saveRoutedMemoryItemDraft(input: {
  repository: MemoryRepository;
  expectedItemId: string;
  draft: MemoryItemDraft;
  original?: MemoryContentBundle;
  setId?: string;
  setOrder?: number;
}): Promise<string> {
  const expectedItemId = input.expectedItemId.trim();
  const matchingItems = input.original?.items.filter((item) => item.id === expectedItemId) ?? [];
  if (!expectedItemId || !input.original || input.draft.id !== expectedItemId || matchingItems.length !== 1) {
    throw routedItemIdentityError();
  }
  return saveMemoryItemDraft({
    repository: input.repository,
    draft: input.draft,
    original: input.original,
    setId: input.setId,
    setOrder: input.setOrder,
  });
}
