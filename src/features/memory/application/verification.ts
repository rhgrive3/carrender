import type {
  MemoryAnswer,
  MemoryExample,
  MemoryExercise,
  MemoryItem,
  MemorySense,
} from '../domain/types';
import type { MemoryRepository } from '../infrastructure/repositories';

type VerifiableRecord = MemoryItem | MemorySense | MemoryAnswer | MemoryExample | MemoryExercise;
type VerifiableType = 'item' | 'sense' | 'answer' | 'example' | 'exercise';

/**
 * Confirms one visible card (one Sense) and its descendants. The Item is only a
 * container, so confirming one Sense may safely confirm that container while
 * sibling Senses keep their own pending state.
 */
export async function verifyMemoryCard(
  repository: MemoryRepository,
  itemId: string,
  senseId: string,
): Promise<number> {
  const content = await repository.loadContent();
  const item = content.items.find((record) => record.id === itemId);
  const sense = content.senses.find((record) => record.id === senseId && record.itemId === itemId);
  if (!item || !sense) throw new Error('確認する暗記カードが見つかりません');

  const candidates: Array<{ entityType: VerifiableType; record: VerifiableRecord }> = [
    { entityType: 'item', record: item },
    { entityType: 'sense', record: sense },
    ...content.answers
      .filter((record) => record.senseId === senseId)
      .map((record) => ({ entityType: 'answer' as const, record })),
    ...content.examples
      .filter((record) => record.senseId === senseId)
      .map((record) => ({ entityType: 'example' as const, record })),
    ...content.exercises
      .filter((record) => record.senseId === senseId)
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
