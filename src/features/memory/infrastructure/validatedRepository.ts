import type { MemoryAnswer, MemoryExample } from '../domain/types';
import {
  languageIssuesForMemoryEntity,
  sameEnglishBearingFields,
} from '../domain/cardIntegrity';
import { MemoryRepository, createMemoryId } from './repositories';

function existingRecord(
  content: Awaited<ReturnType<MemoryRepository['loadContent']>>,
  entityType: string,
  entityId: string,
): unknown {
  switch (entityType) {
    case 'item': return content.items.find((value) => value.id === entityId);
    case 'sense': return content.senses.find((value) => value.id === entityId);
    case 'answer': return content.answers.find((value) => value.id === entityId);
    case 'example': return content.examples.find((value) => value.id === entityId);
    case 'exercise': return content.exercises.find((value) => value.id === entityId);
    default: return undefined;
  }
}

/**
 * Every local memory-content write passes through this repository. UI editors,
 * bulk paste, file import and AI import therefore cannot bypass the same
 * language and parent-reference checks.
 */
export class ValidatedMemoryRepository extends MemoryRepository {
  private resilientClientIdPromise: Promise<string> | null = null;

  override async clientId(): Promise<string> {
    if (this.resilientClientIdPromise) return this.resilientClientIdPromise;

    const initialization = (async () => {
      const existing = await this.store.getMeta<string>('clientId');
      if (existing) return existing;
      const created = createMemoryId('client');
      await this.store.setMeta('clientId', created);
      return created;
    })();
    this.resilientClientIdPromise = initialization;

    try {
      return await initialization;
    } catch (error) {
      // Keep concurrent callers single-flight, but do not retain a rejected
      // promise after a transient IndexedDB failure. A later sync can retry.
      if (this.resilientClientIdPromise === initialization) {
        this.resilientClientIdPromise = null;
      }
      throw error;
    }
  }

  override async saveEntities(
    entities: Parameters<MemoryRepository['saveEntities']>[0],
    preconditions: NonNullable<Parameters<MemoryRepository['saveEntities']>[1]> = [],
  ): Promise<void> {
    const languageFailures = entities.flatMap((entity) => (
      entity.operation === 'delete'
        ? []
        : languageIssuesForMemoryEntity(entity.entityType, entity.value)
          .map((issue) => ({ entity, issue }))
    ));

    let current: Awaited<ReturnType<MemoryRepository['loadContent']>> | undefined;
    if (languageFailures.length > 0 || entities.some((entity) => entity.entityType === 'example')) {
      current = await super.loadContent();
    }

    for (const failure of languageFailures) {
      const before = current
        ? existingRecord(current, failure.entity.entityType, failure.entity.entityId)
        : undefined;
      // Old malformed records must still be verifiable, tombstonable and
      // repairable. Only a create or a change to the malformed English-bearing
      // fields is rejected.
      if (failure.entity.operation !== 'create'
        && before
        && sameEnglishBearingFields(failure.entity.entityType, before, failure.entity.value)) {
        continue;
      }
      throw new Error(failure.issue.message);
    }

    if (current && entities.some((entity) => entity.entityType === 'example')) {
      const answers = new Map(current.answers.map((answer) => [answer.id, answer]));
      for (const entity of entities.filter((value) => value.entityType === 'answer')) {
        const answer = entity.value as MemoryAnswer;
        if (entity.operation === 'delete' || answer.deletedAt) answers.delete(entity.entityId);
        else answers.set(entity.entityId, answer);
      }
      for (const entity of entities.filter((value) => value.entityType === 'example')) {
        if (entity.operation === 'delete') continue;
        const example = entity.value as MemoryExample;
        if (!example.answerId || example.deletedAt) continue;
        const answer = answers.get(example.answerId);
        if (!answer || answer.senseId !== example.senseId) {
          throw new Error('例文と英語表現の対応が壊れています。カードを開き直して例文を保存してください');
        }
      }
    }

    await super.saveEntities(entities, preconditions);
  }
}
