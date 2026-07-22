import { primaryEnglishForSense } from '../domain/cardIntegrity';
import type { MemoryItem, MemorySetMember } from '../domain/types';
import { createMemoryId, type MemoryRepository } from '../infrastructure/repositories';

export interface SplitMemoryItemResult {
  itemIds: string[];
  cardCount: number;
}

function stableMemberOrder(left: MemorySetMember, right: MemorySetMember): number {
  return left.order - right.order
    || left.createdAt.localeCompare(right.createdAt)
    || left.itemId.localeCompare(right.itemId);
}

/**
 * 過去データで1 Itemへ結合された複数Senseを、利用者の明示操作で独立Itemへ戻す。
 * Sense/Answer/Example/Exercise IDは維持し、既存の成績・回答履歴を失わない。
 */
export async function splitMemoryItemIntoCards(
  repository: MemoryRepository,
  itemId: string,
): Promise<SplitMemoryItemResult> {
  const snapshot = await repository.loadSnapshot();
  const item = snapshot.items.find((value) => value.id === itemId);
  if (!item) throw new Error('分割する保存項目が見つかりません');

  const senses = snapshot.senses.filter((sense) => sense.itemId === itemId && !sense.deletedAt);
  if (senses.length <= 1) throw new Error('この保存項目はすでに1枚のカードです');

  const labels = senses.map((sense) => {
    const label = primaryEnglishForSense(snapshot, sense.id, { verifiedOnly: true })
      ?? primaryEnglishForSense(snapshot, sense.id);
    if (!label?.trim()) throw new Error(`「${sense.promptJa || '日本語未設定'}」に英語表現がないため分割できません`);
    return label.trim();
  });

  const activeMembers = snapshot.setMembers.filter((member) => !member.deletedAt);
  const sourceMemberships = activeMembers.filter((member) => member.itemId === itemId);
  const affectedSetIds = new Set(sourceMemberships.map((member) => member.setId));
  const activeSession = await repository.getActiveSession();
  if (activeSession?.selectedSetIds.some((setId) => affectedSetIds.has(setId))) {
    throw new Error('このカードを含む暗記学習が進行中です。学習を終了してから別カードに分けてください');
  }

  const now = new Date().toISOString();
  const itemIds = [item.id, ...senses.slice(1).map(() => createMemoryId('item'))];
  const entities: Parameters<MemoryRepository['saveEntities']>[0] = [];

  const updatedOriginal: MemoryItem = {
    ...item,
    label: labels[0]!,
    lemma: labels[0]!,
    updatedAt: now,
    revision: item.revision + 1,
  };
  entities.push({
    entityType: 'item',
    entityId: updatedOriginal.id,
    value: updatedOriginal,
    operation: 'update',
    baseRevision: item.revision,
  });

  senses.forEach((sense, index) => {
    const nextItemId = itemIds[index]!;
    const label = labels[index]!;
    if (index > 0) {
      const created: MemoryItem = {
        ...item,
        id: nextItemId,
        label,
        lemma: label,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        deletedAt: undefined,
      };
      entities.push({
        entityType: 'item',
        entityId: created.id,
        value: created,
        operation: 'create',
        baseRevision: 0,
      });
    }

    const siblingGroupId = `item:${nextItemId}`;
    const updatedSense = {
      ...sense,
      itemId: nextItemId,
      siblingGroupId,
      updatedAt: now,
      revision: sense.revision + 1,
    };
    entities.push({
      entityType: 'sense',
      entityId: updatedSense.id,
      value: updatedSense,
      operation: 'update',
      baseRevision: sense.revision,
    });

    for (const exercise of snapshot.exercises.filter((value) => value.senseId === sense.id)) {
      if (exercise.siblingGroupId === siblingGroupId) continue;
      const updatedExercise = {
        ...exercise,
        siblingGroupId,
        updatedAt: now,
        revision: exercise.revision + 1,
      };
      entities.push({
        entityType: 'exercise',
        entityId: updatedExercise.id,
        value: updatedExercise,
        operation: 'update',
        baseRevision: exercise.revision,
      });
    }
  });

  for (const setId of affectedSetIds) {
    const members = activeMembers.filter((member) => member.setId === setId).sort(stableMemberOrder);
    const expanded = members.flatMap((member) => {
      if (member.itemId !== itemId) return [member];
      return itemIds.map((nextItemId, index) => index === 0
        ? member
        : { setId, itemId: nextItemId, order: member.order + index, createdAt: now });
    });
    expanded.forEach((member, order) => {
      const updatedMember = { ...member, order };
      entities.push({
        entityType: 'set_member',
        entityId: `${updatedMember.setId}:${updatedMember.itemId}`,
        value: updatedMember,
        operation: 'upsert',
      });
    });
  }

  await repository.saveEntities(entities);
  return { itemIds, cardCount: senses.length };
}
