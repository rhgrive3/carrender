import type { MemoryPendingMutation } from './repositories';

export interface MemoryMutationDependencyAnalysis {
  /** Mutations that can be sent without crossing an unresolved dependency. */
  sendable: MemoryPendingMutation[];
  /** A cycle plus every pending mutation that still depends on that cycle. */
  blocked: MemoryPendingMutation[];
  /** One concrete cycle, in dependency order, for diagnostics. */
  cyclePath: MemoryPendingMutation[];
}

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

function compareMutationOrder(left: MemoryPendingMutation, right: MemoryPendingMutation): number {
  const leftSequence = left.localSequence;
  const rightSequence = right.localSequence;
  if (leftSequence !== undefined || rightSequence !== undefined) {
    if (leftSequence === undefined) return -1;
    if (rightSequence === undefined) return 1;
    if (leftSequence !== rightSequence) return leftSequence - rightSequence;
  }
  if (left.entityKey === right.entityKey) {
    const leftRevision = left.baseRevision ?? (left.operation === 'create' ? 0 : Number.MAX_SAFE_INTEGER);
    const rightRevision = right.baseRevision ?? (right.operation === 'create' ? 0 : Number.MAX_SAFE_INTEGER);
    if (leftRevision !== rightRevision) return leftRevision - rightRevision;
  }
  const byCreatedAt = left.createdAt.localeCompare(right.createdAt);
  return byCreatedAt === 0 ? left.mutationId.localeCompare(right.mutationId) : byCreatedAt;
}

function findCyclePath(outgoing: Set<number>[], unresolved: Set<number>): number[] {
  const color = new Map<number, 0 | 1 | 2>();
  const stack: number[] = [];
  let cycle: number[] = [];

  const visit = (index: number): boolean => {
    color.set(index, 1);
    stack.push(index);
    for (const next of outgoing[index]) {
      if (!unresolved.has(next)) continue;
      const nextColor = color.get(next) ?? 0;
      if (nextColor === 0) {
        if (visit(next)) return true;
      } else if (nextColor === 1) {
        const cycleStart = stack.indexOf(next);
        cycle = cycleStart >= 0 ? stack.slice(cycleStart) : [next];
        return true;
      }
    }
    stack.pop();
    color.set(index, 2);
    return false;
  };

  for (const index of unresolved) {
    if ((color.get(index) ?? 0) === 0 && visit(index)) break;
  }
  return cycle;
}

/**
 * Mirrors the repository's dependency ordering, but never falls back to sending
 * unsortable rows. Kahn's emitted prefix is safe; the remainder contains a
 * cycle and any descendants that cannot be sent until that cycle is repaired.
 */
export function analyzeMemoryMutationDependencies(
  mutations: MemoryPendingMutation[],
): MemoryMutationDependencyAnalysis {
  const ordered = [...mutations].sort(compareMutationOrder);
  const byEntity = new Map<string, number[]>();
  ordered.forEach((mutation, index) => {
    const list = byEntity.get(mutation.entityKey);
    if (list) list.push(index);
    else byEntity.set(mutation.entityKey, [index]);
  });

  const outgoing = ordered.map(() => new Set<number>());
  const incoming = ordered.map(() => 0);
  const addEdge = (from: number, to: number) => {
    if (from === to || outgoing[from].has(to)) return;
    outgoing[from].add(to);
    incoming[to] += 1;
  };

  for (const indices of byEntity.values()) {
    for (let index = 1; index < indices.length; index += 1) {
      addEdge(indices[index - 1], indices[index]);
    }
  }

  ordered.forEach((mutation, index) => {
    for (const dependencyKey of dependencyEntityKeys(mutation)) {
      for (const dependencyIndex of byEntity.get(dependencyKey) ?? []) {
        const dependency = ordered[dependencyIndex];
        if (isDeletionMutation(mutation) && isDeletionMutation(dependency)) {
          addEdge(index, dependencyIndex);
        } else if (!isDeletionMutation(mutation) && !isDeletionMutation(dependency)) {
          addEdge(dependencyIndex, index);
        }
      }
    }
  });

  const available: number[] = [];
  incoming.forEach((count, index) => {
    if (count === 0) available.push(index);
  });

  const emitted: number[] = [];
  while (available.length > 0) {
    available.sort((left, right) => left - right);
    const index = available.shift()!;
    emitted.push(index);
    for (const next of outgoing[index]) {
      incoming[next] -= 1;
      if (incoming[next] === 0) available.push(next);
    }
  }

  const emittedSet = new Set(emitted);
  const unresolved = new Set(
    ordered.map((_, index) => index).filter((index) => !emittedSet.has(index)),
  );
  const cyclePath = findCyclePath(outgoing, unresolved);

  return {
    sendable: emitted.map((index) => ordered[index]),
    blocked: [...unresolved].sort((left, right) => left - right).map((index) => ordered[index]),
    cyclePath: cyclePath.map((index) => ordered[index]),
  };
}

export class MemoryMutationDependencyCycleError extends Error {
  readonly mutationIds: string[];
  readonly entityKeys: string[];
  readonly cycleMutationIds: string[];
  readonly cycleEntityKeys: string[];

  constructor(analysis: MemoryMutationDependencyAnalysis) {
    const entityKeys = [...new Set(analysis.blocked.map((mutation) => mutation.entityKey))];
    const cycleEntityKeys = [...new Set(analysis.cyclePath.map((mutation) => mutation.entityKey))];
    const pathKeys = cycleEntityKeys.length > 0 ? cycleEntityKeys : entityKeys;
    const displayedPath = pathKeys.length > 0
      ? [...pathKeys.slice(0, 6), pathKeys[0]].join(' → ')
      : '不明な待機データ';
    const hiddenCount = Math.max(0, entityKeys.length - 6);
    const suffix = hiddenCount > 0 ? `（ほか${hiddenCount}件）` : '';

    super(
      `暗記同期の待機データに依存関係の循環があります（${displayedPath}${suffix}）。`
      + '該当データとその依存先は送信せず端末に保持しました。カード・セットを開き直して保存し直してください。',
    );
    this.name = 'MemoryMutationDependencyCycleError';
    this.mutationIds = analysis.blocked.map((mutation) => mutation.mutationId);
    this.entityKeys = entityKeys;
    this.cycleMutationIds = analysis.cyclePath.map((mutation) => mutation.mutationId);
    this.cycleEntityKeys = cycleEntityKeys;
  }
}
