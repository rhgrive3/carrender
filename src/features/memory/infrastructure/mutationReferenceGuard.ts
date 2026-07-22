import type { MemoryLocalSnapshot, MemoryPendingMutation } from './repositories';

export interface MemoryMutationReferenceProblem {
  mutationId: string;
  entityKey: string;
  missingDependencyKeys: string[];
}

export interface MemoryMutationReferenceAnalysis {
  sendable: MemoryPendingMutation[];
  blocked: MemoryPendingMutation[];
  problems: MemoryMutationReferenceProblem[];
}

function payloadRecord(mutation: MemoryPendingMutation): Record<string, unknown> {
  return mutation.payload && typeof mutation.payload === 'object' && !Array.isArray(mutation.payload)
    ? mutation.payload as Record<string, unknown>
    : {};
}

function entityKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

function dependencyKeys(mutation: MemoryPendingMutation): string[] {
  const payload = payloadRecord(mutation);
  const text = (key: string) => typeof payload[key] === 'string' ? String(payload[key]) : undefined;
  switch (mutation.entityType) {
    case 'sense': {
      const itemId = text('itemId');
      return itemId ? [entityKey('item', itemId)] : [];
    }
    case 'answer': {
      const senseId = text('senseId');
      return senseId ? [entityKey('sense', senseId)] : [];
    }
    case 'example':
    case 'exercise': {
      const dependencies: string[] = [];
      const senseId = text('senseId');
      const answerId = text('answerId');
      if (senseId) dependencies.push(entityKey('sense', senseId));
      if (answerId) dependencies.push(entityKey('answer', answerId));
      if (mutation.entityType === 'exercise' && Array.isArray(payload.acceptedAnswerIds)) {
        for (const id of payload.acceptedAnswerIds) {
          if (typeof id === 'string') dependencies.push(entityKey('answer', id));
        }
      }
      return [...new Set(dependencies)];
    }
    case 'set_member': {
      const setId = text('setId');
      const itemId = text('itemId');
      return [
        ...(setId ? [entityKey('set', setId)] : []),
        ...(itemId ? [entityKey('item', itemId)] : []),
      ];
    }
    case 'stat_preference': {
      const targetType = text('targetType');
      const targetId = text('targetId');
      return targetId && (targetType === 'sense' || targetType === 'answer' || targetType === 'exercise')
        ? [entityKey(targetType, targetId)]
        : [];
    }
    default:
      return [];
  }
}

function isDeletion(mutation: MemoryPendingMutation): boolean {
  return mutation.operation === 'delete' || typeof payloadRecord(mutation).deletedAt === 'string';
}

function existingEntityKeys(snapshot: MemoryLocalSnapshot): Set<string> {
  return new Set([
    ...snapshot.items.map((value) => entityKey('item', value.id)),
    ...snapshot.senses.map((value) => entityKey('sense', value.id)),
    ...snapshot.answers.map((value) => entityKey('answer', value.id)),
    ...snapshot.examples.map((value) => entityKey('example', value.id)),
    ...snapshot.exercises.map((value) => entityKey('exercise', value.id)),
    ...snapshot.sets.map((value) => entityKey('set', value.id)),
    ...snapshot.setMembers.map((value) => entityKey('set_member', `${value.setId}:${value.itemId}`)),
    ...snapshot.stats.map((value) => entityKey('stat_preference', value.id)),
  ]);
}

/**
 * Revalidates references after conflict resolution. A server choice can remove a
 * parent that previously kept its children blocked behind the conflict. Those
 * children must remain local instead of becoming uploadable orphan mutations.
 */
export function analyzeMemoryMutationReferences(
  pending: MemoryPendingMutation[],
  snapshot: MemoryLocalSnapshot,
): MemoryMutationReferenceAnalysis {
  const existing = existingEntityKeys(snapshot);
  const pendingLive = new Set(
    pending.filter((mutation) => !isDeletion(mutation)).map((mutation) => mutation.entityKey),
  );
  const blockedKeys = new Set<string>();
  const missingByMutation = new Map<string, Set<string>>();

  const block = (mutation: MemoryPendingMutation, missing: string[]) => {
    blockedKeys.add(mutation.entityKey);
    const known = missingByMutation.get(mutation.mutationId) ?? new Set<string>();
    missing.forEach((key) => known.add(key));
    missingByMutation.set(mutation.mutationId, known);
  };

  for (const mutation of pending) {
    if (isDeletion(mutation)) continue;
    const missing = dependencyKeys(mutation).filter((key) => !existing.has(key) && !pendingLive.has(key));
    if (missing.length > 0) block(mutation, missing);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const mutation of pending) {
      if (isDeletion(mutation) || blockedKeys.has(mutation.entityKey)) continue;
      const blockedDependencies = dependencyKeys(mutation).filter((key) => blockedKeys.has(key));
      if (blockedDependencies.length === 0) continue;
      block(mutation, blockedDependencies);
      changed = true;
    }
  }

  const blocked = pending.filter((mutation) => blockedKeys.has(mutation.entityKey));
  const sendable = pending.filter((mutation) => !blockedKeys.has(mutation.entityKey));
  const problems = blocked.map((mutation) => ({
    mutationId: mutation.mutationId,
    entityKey: mutation.entityKey,
    missingDependencyKeys: [...(missingByMutation.get(mutation.mutationId) ?? [])].sort(),
  }));
  return { sendable, blocked, problems };
}

export class MemoryMutationReferenceError extends Error {
  readonly problems: MemoryMutationReferenceProblem[];

  constructor(analysis: MemoryMutationReferenceAnalysis) {
    const details = analysis.problems
      .filter((problem) => problem.missingDependencyKeys.length > 0)
      .map((problem) => `${problem.entityKey} → ${problem.missingDependencyKeys.join(', ')}`)
      .join(' / ');
    super(`競合解消後に参照先を確認できない暗記データが残っています。カード管理で修正してください${details ? `（${details}）` : ''}`);
    this.name = 'MemoryMutationReferenceError';
    this.problems = analysis.problems;
  }
}
