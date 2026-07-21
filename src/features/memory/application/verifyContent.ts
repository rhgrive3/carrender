import type {
  MemoryAnswer,
  MemoryExample,
  MemoryExercise,
  MemoryItem,
  MemorySense,
} from '../domain/types';
import type { MemoryRepository } from '../infrastructure/repositories';

/**
 * Marks the one displayed Sense and its descendants as reviewed.
 * The parent Item is also verified because every learning target requires a
 * verified Item, but sibling Senses remain untouched and keep their own review
 * buttons until the user confirms them.
 */
export async function verifyDisplayedMemoryCard(
  repository: MemoryRepository,
  senseId: string,
): Promise<number> {
  const content = await repository.loadContent();
  const sense = content.senses.find((record) => !record.deletedAt && record.id === senseId);
  if (!sense) throw new Error('確認する暗記カードが見つかりません');
  const item = content.items.find((record) => !record.deletedAt && record.id === sense.itemId);
  if (!item) throw new Error('確認する暗記項目が見つかりません');

  const candidates: Array<{
    entityType: 'item' | 'sense' | 'answer' | 'example' | 'exercise';
    record: MemoryItem | MemorySense | MemoryAnswer | MemoryExample | MemoryExercise;
  }> = [
    { entityType: 'item', record: item },
    { entityType: 'sense', record: sense },
    ...content.answers
      .filter((record) => !record.deletedAt && record.senseId === sense.id)
      .map((record) => ({ entityType: 'answer' as const, record })),
    ...content.examples
      .filter((record) => !record.deletedAt && record.senseId === sense.id)
      .map((record) => ({ entityType: 'example' as const, record })),
    ...content.exercises
      .filter((record) => !record.deletedAt && record.senseId === sense.id)
      .map((record) => ({ entityType: 'exercise' as const, record })),
  ];

  const now = new Date().toISOString();
  const entities: Parameters<MemoryRepository['saveEntities']>[0] = candidates
    .filter(({ record }) => record.verificationStatus === 'unverified_ai')
    .map(({ entityType, record }) => ({
      entityType,
      entityId: record.id,
      value: {
        ...record,
        verificationStatus: 'verified' as const,
        revision: record.revision + 1,
        updatedAt: now,
      },
      operation: 'update' as const,
      baseRevision: record.revision,
    }));

  if (entities.length > 0) await repository.saveEntities(entities);
  return entities.length;
}
