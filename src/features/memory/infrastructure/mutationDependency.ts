import type { MemoryPendingMutation } from './repositories';

function payloadRecord(mutation: MemoryPendingMutation): Record<string, unknown> {
  return mutation.payload && typeof mutation.payload === 'object' && !Array.isArray(mutation.payload)
    ? mutation.payload as Record<string, unknown>
    : {};
}

function entityIdentity(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

function dependencyEntityKeys(mutation: MemoryPendingMutation): string[] {
  const payload = payloadRecord(mutation);
  const stringField = (key: string) => typeof payload[key] === 'string' ? String(payload[key]) : undefined;
  switch (mutation.entityType) {
    case 'sense': {
      const itemId = stringField('itemId');
      return itemId ? [entityIdentity('item', itemId)] : [];
    }
    case 'answer': {
      const senseId = stringField('senseId');
      return senseId ? [entityIdentity('sense', senseId)] : [];
    }
    case 'example':
    case 'exercise': {
      const keys: string[] = [];
      const senseId = stringField('senseId');
      const answerId = stringField('answerId');
      if (senseId) keys.push(entityIdentity('sense', senseId));
      if (answerId) keys.push(entityIdentity('answer', answerId));
      if (mutation.entityType === 'exercise' && Array.isArray(payload.acceptedAnswerIds)) {
        for (const id of payload.acceptedAnswerIds) {
          if (typeof id === 'string') keys.push(entityIdentity('answer', id));
        }
      }
      return [...new Set(keys)];
    }
    case 'set_member': {
      const setId = stringField('setId');
      const itemId = stringField('itemId');
      return [
        ...(setId ? [entityIdentity('set', setId)] : []),
        ...(itemId ? [entityIdentity('item', itemId)] : []),
      ];
    }
    case 'stat_preference': {
      const targetType = stringField('targetType');
      const targetId = stringField('targetId');
      return targetId && (targetType === 'sense' || targetType === 'answer' || targetType === 'exercise')
        ? [entityIdentity(targetType, targetId)]
        : [];
    }
    default:
      return [];
  }
}

function isDeletionMutation(mutation: MemoryPendingMutation): boolean {
  return mutation.operation === 'delete' || typeof payloadRecord(mutation).deletedAt === 'string';
}

export interface MutationDependencyAnalysis {
  safeMutationIds: Set<string>;
  blockedMutationIds: Set<string>;
  blockedEntityKeys: string[];
}

/**
 * Returns the mutations that can be sent without crossing a dependency cycle.
 * Any cycle and every mutation downstream from that cycle stay queued.
 */
export function analyzeMutationDependencies(mutations: MemoryPendingMutation[]): MutationDependencyAnalysis {
  const byEntity = new Map<string, number[]>();
  mutations.forEach((mutation, index) => {
    const list = byEntity.get(mutation.entityKey);
    if (list) list.push(index);
    else byEntity.set(mutation.entityKey, [index]);
  });

  const outgoing = mutations.map(() => new Set<number>());
  const incoming = mutations.map(() => 0);
  const addEdge = (from: number, to: number) => {
    if (from === to || outgoing[from].has(to)) return;
    outgoing[from].add(to);
    incoming[to] += 1;
  };

  for (const indices of byEntity.values()) {
    for (let index = 1; index < indices.length; index += 1) addEdge(indices[index - 1], indices[index]);
  }

  mutations.forEach((mutation, index) => {
    for (const dependencyKey of dependencyEntityKeys(mutation)) {
      for (const dependencyIndex of byEntity.get(dependencyKey) ?? []) {
        const dependency = mutations[dependencyIndex];
        if (isDeletionMutation(mutation) && isDeletionMutation(dependency)) addEdge(index, dependencyIndex);
        else if (!isDeletionMutation(mutation) && !isDeletionMutation(dependency)) addEdge(dependencyIndex, index);
      }
    }
  });

  const available: number[] = [];
  incoming.forEach((count, index) => { if (count === 0) available.push(index); });
  const safeMutationIds = new Set<string>();
  while (available.length > 0) {
    available.sort((left, right) => left - right);
    const index = available.shift()!;
    safeMutationIds.add(mutations[index].mutationId);
    for (const next of outgoing[index]) {
      incoming[next] -= 1;
      if (incoming[next] === 0) available.push(next);
    }
  }

  const blocked = mutations.filter((mutation) => !safeMutationIds.has(mutation.mutationId));
  return {
    safeMutationIds,
    blockedMutationIds: new Set(blocked.map((mutation) => mutation.mutationId)),
    blockedEntityKeys: [...new Set(blocked.map((mutation) => mutation.entityKey))].sort(),
  };
}
