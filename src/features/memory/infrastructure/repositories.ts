import type {
  MemoryAnswer,
  MemoryAttempt,
  MemoryContentBundle,
  MemoryExample,
  MemoryExercise,
  MemoryItem,
  MemorySense,
  MemorySession,
  MemorySet,
  MemorySetBundle,
  MemorySetMember,
  MemoryStat,
} from '../domain/types';
import {
  IndexedDbMemoryStore,
  MEMORY_STORES,
  type MemoryStoreName,
  type MemoryTransactionAccessor,
  type MemoryWriteOperation,
  type MemoryWritePrecondition,
} from './indexedDb';

export type MemoryEntityType =
  | 'item'
  | 'sense'
  | 'answer'
  | 'example'
  | 'exercise'
  | 'set'
  | 'set_member'
  | 'session'
  | 'stat_preference'
  | 'attempt_void';

export type MemoryMutationOperation = 'create' | 'update' | 'delete' | 'upsert';

export interface MemoryPendingMutation {
  mutationId: string;
  clientId: string;
  entityType: MemoryEntityType;
  entityId: string;
  entityKey: string;
  operation: MemoryMutationOperation;
  baseRevision?: number;
  payload: unknown;
  createdAt: string;
  /** Local-only monotonic order. It is stripped before an API request. */
  localSequence?: number;
}

export interface MemoryConflict {
  id: string;
  mutationId?: string;
  entityType: MemoryEntityType;
  entityId: string;
  entityKey: string;
  localValue: unknown;
  serverValue: unknown;
  baseRevision?: number;
  createdAt: string;
  resolvedAt?: string;
  resolution?: 'local' | 'server' | 'merged';
}

export interface LocalMemoryAttempt extends MemoryAttempt {
  undoneAt?: string;
}

export interface MemoryLocalSnapshot extends MemorySetBundle {
  stats: MemoryStat[];
}

export interface RemoteMemoryChanges extends Partial<MemoryLocalSnapshot> {
  sessions?: MemorySession[];
  attempts?: LocalMemoryAttempt[];
}

type StoredMemoryEntityType = Exclude<MemoryEntityType, 'attempt_void' | 'stat_preference'>;

const ENTITY_STORES: Record<StoredMemoryEntityType, MemoryStoreName> = {
  item: MEMORY_STORES.items,
  sense: MEMORY_STORES.senses,
  answer: MEMORY_STORES.answers,
  example: MEMORY_STORES.examples,
  exercise: MEMORY_STORES.exercises,
  set: MEMORY_STORES.sets,
  set_member: MEMORY_STORES.setMembers,
  session: MEMORY_STORES.sessions,
};

export function createMemoryId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function statId(targetType: MemoryStat['targetType'], targetId: string, mode: MemoryStat['mode']): string {
  return `${targetType}:${targetId}:${mode}`;
}

function entityIdentity(entityType: MemoryEntityType, entityId: string): string {
  return `${entityType}:${entityId}`;
}

function revisionOf(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const revision = (value as { revision?: unknown }).revision;
  return typeof revision === 'number' && Number.isInteger(revision) ? revision : undefined;
}

function mutationFor(
  clientId: string,
  entityType: MemoryEntityType,
  entityId: string,
  operation: MemoryMutationOperation,
  payload: unknown,
  baseRevision?: number,
): MemoryPendingMutation {
  return {
    mutationId: createMemoryId('mut'),
    clientId,
    entityType,
    entityId,
    entityKey: entityIdentity(entityType, entityId),
    operation,
    baseRevision,
    payload,
    createdAt: new Date().toISOString(),
  };
}

function active<T extends { deletedAt?: string }>(rows: T[]): T[] {
  return rows.filter((row) => !row.deletedAt);
}

function payloadRecord(mutation: MemoryPendingMutation): Record<string, unknown> {
  return mutation.payload && typeof mutation.payload === 'object' && !Array.isArray(mutation.payload)
    ? mutation.payload as Record<string, unknown>
    : {};
}

function statIdsForAttempt(attempt: Pick<LocalMemoryAttempt, 'senseId' | 'answerId' | 'exerciseId' | 'mode'>): string[] {
  if (attempt.exerciseId) {
    return [
      ...(attempt.answerId ? [statId('answer', attempt.answerId, attempt.mode)] : []),
      statId('exercise', attempt.exerciseId, attempt.mode),
    ];
  }
  return [
    statId('sense', attempt.senseId, attempt.mode),
    ...(attempt.answerId ? [statId('answer', attempt.answerId, attempt.mode)] : []),
  ];
}

function statPreferenceId(mutation: Pick<MemoryPendingMutation, 'entityType' | 'entityId'>): string | undefined {
  return mutation.entityType === 'stat_preference' ? mutation.entityId : undefined;
}

function immutableAttemptSignature(attempt: LocalMemoryAttempt): string {
  return JSON.stringify([
    attempt.attemptId,
    attempt.sessionId,
    attempt.clientId,
    attempt.itemId,
    attempt.senseId,
    attempt.answerId ?? null,
    attempt.exerciseId ?? null,
    attempt.targetId,
    attempt.mode,
    attempt.exerciseType,
    attempt.userAnswer ?? null,
    attempt.normalizedAnswer ?? null,
    attempt.assessment,
    attempt.errorTypes,
    attempt.hintUsed,
    attempt.responseMs,
    attempt.createdAt,
  ]);
}

async function appendPendingMutations(
  transaction: MemoryTransactionAccessor,
  mutations: MemoryPendingMutation[],
): Promise<void> {
  if (mutations.length === 0) return;
  const counter = await transaction.get<{ key: string; value: number }>(MEMORY_STORES.meta, 'nextMutationSequence');
  let sequence = Number.isSafeInteger(counter?.value) && (counter?.value ?? 0) > 0 ? counter!.value : 1;
  for (const mutation of mutations) {
    transaction.put(MEMORY_STORES.pendingMutations, { ...mutation, localSequence: sequence });
    sequence += 1;
  }
  transaction.put(MEMORY_STORES.meta, { key: 'nextMutationSequence', value: sequence });
}

async function replacePendingMutation(
  transaction: MemoryTransactionAccessor,
  mutation: MemoryPendingMutation,
): Promise<void> {
  const existing = await transaction.getAllFromIndex<MemoryPendingMutation>(
    MEMORY_STORES.pendingMutations,
    'entityKey',
    mutation.entityKey,
  );
  for (const pending of existing) transaction.delete(MEMORY_STORES.pendingMutations, pending.mutationId);
  await appendPendingMutations(transaction, [mutation]);
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

function relationKeysForClient(entityType: MemoryEntityType): string[] {
  switch (entityType) {
    case 'sense': return ['itemId'];
    case 'answer': return ['senseId'];
    case 'example': return ['senseId', 'answerId'];
    case 'exercise': return ['senseId', 'answerId'];
    default: return [];
  }
}

function isDeletionMutation(mutation: MemoryPendingMutation): boolean {
  return mutation.operation === 'delete' || typeof payloadRecord(mutation).deletedAt === 'string';
}

function expandBlockedEntityKeys(
  mutations: MemoryPendingMutation[],
  initiallyBlocked: Iterable<string>,
): Set<string> {
  const blocked = new Set(initiallyBlocked);
  let changed = true;
  while (changed) {
    changed = false;
    for (const mutation of mutations) {
      const dependencies = dependencyEntityKeys(mutation);
      const additions = isDeletionMutation(mutation)
        // Tombstones are ordered child-first: a blocked child must keep its
        // parent tombstone queued until the child conflict is resolved.
        ? (blocked.has(mutation.entityKey) ? dependencies : [])
        // Creates/updates are parent-first: a blocked parent transitively blocks
        // every pending descendant.
        : (dependencies.some((dependency) => blocked.has(dependency)) ? [mutation.entityKey] : []);
      for (const key of additions) {
        if (blocked.has(key)) continue;
        blocked.add(key);
        changed = true;
      }
    }
  }
  return blocked;
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

/**
 * Produces a stable dependency order while preserving every per-entity mutation
 * chain. Creates/updates run parent-first; tombstones run child-first.
 */
function sortPendingMutationsForSync(mutations: MemoryPendingMutation[]): MemoryPendingMutation[] {
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
    for (let index = 1; index < indices.length; index += 1) addEdge(indices[index - 1], indices[index]);
  }
  ordered.forEach((mutation, index) => {
    for (const dependencyKey of dependencyEntityKeys(mutation)) {
      for (const dependencyIndex of byEntity.get(dependencyKey) ?? []) {
        const dependency = ordered[dependencyIndex];
        if (isDeletionMutation(mutation) && isDeletionMutation(dependency)) addEdge(index, dependencyIndex);
        else if (!isDeletionMutation(mutation) && !isDeletionMutation(dependency)) addEdge(dependencyIndex, index);
      }
    }
  });

  const available: number[] = [];
  incoming.forEach((count, index) => { if (count === 0) available.push(index); });
  const result: MemoryPendingMutation[] = [];
  while (available.length > 0) {
    available.sort((left, right) => left - right);
    const index = available.shift()!;
    result.push(ordered[index]);
    for (const next of outgoing[index]) {
      incoming[next] -= 1;
      if (incoming[next] === 0) available.push(next);
    }
  }
  if (result.length !== ordered.length) {
    const emitted = new Set(result.map((mutation) => mutation.mutationId));
    result.push(...ordered.filter((mutation) => !emitted.has(mutation.mutationId)));
  }
  return result;
}

function remoteRecordShouldReplace(local: unknown, remote: unknown): boolean {
  if (!local || typeof local !== 'object' || !remote || typeof remote !== 'object') return true;
  const localRecord = local as { revision?: unknown; updatedAt?: unknown };
  const remoteRecord = remote as { revision?: unknown; updatedAt?: unknown };
  if (typeof localRecord.revision === 'number' && typeof remoteRecord.revision === 'number') {
    return remoteRecord.revision >= localRecord.revision;
  }
  if (typeof localRecord.updatedAt === 'string' && typeof remoteRecord.updatedAt === 'string') {
    return remoteRecord.updatedAt >= localRecord.updatedAt;
  }
  return true;
}

async function applyRemoteChangesInTransaction(
  transaction: MemoryTransactionAccessor,
  changes: RemoteMemoryChanges,
  blockedEntityKeys: Set<string>,
  blockedStatIds: Set<string> = new Set(),
): Promise<void> {
  const add = async (entityType: StoredMemoryEntityType, rows: unknown[] | undefined) => {
    if (!rows) return;
    const store = ENTITY_STORES[entityType];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const record = row as { id?: string; setId?: string; itemId?: string };
      const id = entityType === 'set_member' ? `${record.setId ?? ''}:${record.itemId ?? ''}` : record.id ?? '';
      if (!id || blockedEntityKeys.has(entityIdentity(entityType, id))) continue;
      const key: IDBValidKey = entityType === 'set_member'
        ? [record.setId ?? '', record.itemId ?? '']
        : id;
      const local = await transaction.get<unknown>(store, key);
      if (remoteRecordShouldReplace(local, row)) transaction.put(store, row);
    }
  };
  await add('item', changes.items);
  await add('sense', changes.senses);
  await add('answer', changes.answers);
  await add('example', changes.examples);
  await add('exercise', changes.exercises);
  await add('set', changes.sets);
  await add('set_member', changes.setMembers);
  await add('session', changes.sessions);
  for (const stat of changes.stats ?? []) {
    if (!stat || typeof stat !== 'object' || typeof (stat as { id?: unknown }).id !== 'string') continue;
    const id = (stat as { id: string }).id;
    if (blockedStatIds.has(id)) continue;
    const local = await transaction.get<unknown>(MEMORY_STORES.stats, id);
    if (remoteRecordShouldReplace(local, stat)) transaction.put(MEMORY_STORES.stats, stat);
  }
  for (const attempt of changes.attempts ?? []) {
    if (!attempt || typeof attempt !== 'object' || typeof (attempt as { attemptId?: unknown }).attemptId !== 'string') continue;
    const remote = attempt as LocalMemoryAttempt;
    const local = await transaction.get<LocalMemoryAttempt>(MEMORY_STORES.attempts, remote.attemptId);
    // An undo can commit while the request is in flight. Never resurrect it when
    // the response contains the pre-void representation of the same attempt.
    // Attempts are append-only. Once an attempt id exists locally, remote pulls
    // may only add receipt/void metadata; they must never replace its answer.
    const merged = local
      ? {
          ...local,
          ...(remote.syncedAt ? { syncedAt: remote.syncedAt } : {}),
          ...(remote.undoneAt || local.undoneAt
            ? { undoneAt: [remote.undoneAt, local.undoneAt].filter((value): value is string => Boolean(value)).sort().pop() }
            : {}),
        }
      : remote;
    transaction.put(MEMORY_STORES.attempts, merged);
  }
}

export interface MemorySyncCommit {
  serverTime: string;
  cursor: string;
  acceptedMutationIds: string[];
  acceptedAttemptIds: string[];
  sentAttemptIds: string[];
  conflicts: MemoryConflict[];
  changes: RemoteMemoryChanges;
}

export class MemoryRepository {
  readonly store: IndexedDbMemoryStore;
  private clientIdPromise: Promise<string> | null = null;

  constructor(readonly owner: string) {
    this.store = new IndexedDbMemoryStore(owner);
  }

  async clientId(): Promise<string> {
    this.clientIdPromise ??= (async () => {
      const existing = await this.store.getMeta<string>('clientId');
      if (existing) return existing;
      const created = createMemoryId('client');
      await this.store.setMeta('clientId', created);
      return created;
    })();
    return this.clientIdPromise;
  }

  async loadContent(): Promise<MemoryContentBundle> {
    const [items, senses, answers, examples, exercises] = await Promise.all([
      this.store.getAll<MemoryItem>(MEMORY_STORES.items),
      this.store.getAll<MemorySense>(MEMORY_STORES.senses),
      this.store.getAll<MemoryAnswer>(MEMORY_STORES.answers),
      this.store.getAll<MemoryExample>(MEMORY_STORES.examples),
      this.store.getAll<MemoryExercise>(MEMORY_STORES.exercises),
    ]);
    return {
      items: active(items),
      senses: active(senses),
      answers: active(answers),
      examples: active(examples),
      exercises: active(exercises),
    };
  }

  async loadSnapshot(): Promise<MemoryLocalSnapshot> {
    const [content, sets, setMembers, stats] = await Promise.all([
      this.loadContent(),
      this.store.getAll<MemorySet>(MEMORY_STORES.sets),
      this.store.getAll<MemorySetMember>(MEMORY_STORES.setMembers),
      this.store.getAll<MemoryStat>(MEMORY_STORES.stats),
    ]);
    return { ...content, sets: active(sets), setMembers: active(setMembers), stats };
  }

  async loadSetBundle(setIds: string[]): Promise<MemorySetBundle> {
    const selectedIds = new Set(setIds);
    const [sets, allMembers, content] = await Promise.all([
      this.store.getAll<MemorySet>(MEMORY_STORES.sets),
      this.store.getAll<MemorySetMember>(MEMORY_STORES.setMembers),
      this.loadContent(),
    ]);
    const setMembers = active(allMembers).filter((member) => selectedIds.has(member.setId));
    const itemIds = new Set(setMembers.map((member) => member.itemId));
    const items = content.items.filter((item) => itemIds.has(item.id));
    const senseItemIds = new Set(items.map((item) => item.id));
    const senses = content.senses.filter((sense) => senseItemIds.has(sense.itemId));
    const senseIds = new Set(senses.map((sense) => sense.id));
    return {
      sets: active(sets).filter((set) => selectedIds.has(set.id)),
      setMembers,
      items,
      senses,
      answers: content.answers.filter((answer) => senseIds.has(answer.senseId)),
      examples: content.examples.filter((example) => senseIds.has(example.senseId)),
      exercises: content.exercises.filter((exercise) => senseIds.has(exercise.senseId)),
    };
  }

  async listSets(): Promise<MemorySet[]> {
    const sets = active(await this.store.getAll<MemorySet>(MEMORY_STORES.sets));
    return sets.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async listSetMembers(setId: string): Promise<MemorySetMember[]> {
    const rows = await this.store.getAllFromIndex<MemorySetMember>(MEMORY_STORES.setMembers, 'setId', setId);
    return active(rows).sort((left, right) => left.order - right.order);
  }

  async getStats(targetIds?: Set<string>): Promise<MemoryStat[]> {
    if (!targetIds) return this.store.getAll<MemoryStat>(MEMORY_STORES.stats);
    const groups = await Promise.all(
      [...targetIds].map((targetId) => this.store.getAllFromIndex<MemoryStat>(MEMORY_STORES.stats, 'targetId', targetId)),
    );
    return [...new Map(groups.flat().map((stat) => [stat.id, stat])).values()];
  }

  async saveEntities(
    entities: Array<{ entityType: StoredMemoryEntityType; entityId: string; value: unknown; operation: MemoryMutationOperation; baseRevision?: number }>,
    preconditions: MemoryWritePrecondition[] = [],
  ): Promise<void> {
    if (entities.length === 0 && preconditions.length === 0) return;
    const clientId = await this.clientId();
    const operations: MemoryWriteOperation[] = [];
    const mutations: MemoryPendingMutation[] = [];
    for (const entity of entities) {
      const mutation = mutationFor(
        clientId,
        entity.entityType,
        entity.entityId,
        entity.operation,
        entity.value,
        entity.baseRevision,
      );
      operations.push({ store: ENTITY_STORES[entity.entityType], type: 'put', value: entity.value });
      mutations.push(mutation);
    }
    await this.store.writeWithPendingMutations(operations, mutations, preconditions);
  }

  async createSet(set: MemorySet): Promise<void> {
    await this.saveEntities([{ entityType: 'set', entityId: set.id, value: set, operation: 'create', baseRevision: 0 }]);
  }

  async saveSetMember(member: MemorySetMember): Promise<void> {
    await this.saveEntities([{
      entityType: 'set_member',
      entityId: `${member.setId}:${member.itemId}`,
      value: member,
      operation: 'upsert',
    }]);
  }

  async saveContentBundle(bundle: MemoryContentBundle, setMembers: MemorySetMember[] = []): Promise<void> {
    const entities: Array<{
      entityType: StoredMemoryEntityType;
      entityId: string;
      value: unknown;
      operation: MemoryMutationOperation;
      baseRevision?: number;
    }> = [];
    const addRevisioned = (
      entityType: 'item' | 'sense' | 'answer' | 'example' | 'exercise',
      rows: Array<{ id: string; revision: number }>,
    ) => {
      for (const row of rows) {
        entities.push({
          entityType,
          entityId: row.id,
          value: row,
          operation: row.revision <= 1 ? 'create' : 'update',
          baseRevision: Math.max(0, row.revision - 1),
        });
      }
    };
    addRevisioned('item', bundle.items);
    addRevisioned('sense', bundle.senses);
    addRevisioned('answer', bundle.answers);
    addRevisioned('example', bundle.examples);
    addRevisioned('exercise', bundle.exercises);
    for (const member of setMembers) {
      entities.push({
        entityType: 'set_member',
        entityId: `${member.setId}:${member.itemId}`,
        value: member,
        operation: 'upsert',
      });
    }
    await this.saveEntities(entities);
  }

  async tombstone(
    entityType: 'item' | 'sense' | 'answer' | 'example' | 'exercise' | 'set',
    entityId: string,
  ): Promise<void> {
    const storeName = ENTITY_STORES[entityType];
    const current = await this.store.get<Record<string, unknown>>(storeName, entityId);
    if (!current) return;
    const revision = revisionOf(current) ?? 0;
    const tombstone = {
      ...current,
      revision: revision + 1,
      updatedAt: new Date().toISOString(),
      deletedAt: new Date().toISOString(),
    };
    await this.saveEntities([{
      entityType,
      entityId,
      value: tombstone,
      operation: 'delete',
      baseRevision: revision,
    }]);
  }

  async saveAttempt(attempt: LocalMemoryAttempt, stats: MemoryStat[], session: MemorySession): Promise<void> {
    const clientId = await this.clientId();
    const sessionMutation = mutationFor(clientId, 'session', session.id, 'upsert', session);
    await this.store.transaction(
      [
        MEMORY_STORES.attempts,
        MEMORY_STORES.sessions,
        MEMORY_STORES.stats,
        MEMORY_STORES.pendingMutations,
        MEMORY_STORES.meta,
      ],
      'readwrite',
      async (transaction) => {
        const existing = await transaction.get<LocalMemoryAttempt>(MEMORY_STORES.attempts, attempt.attemptId);
        if (existing) {
          if (immutableAttemptSignature(existing) !== immutableAttemptSignature(attempt)) {
            throw new Error('同じattemptIdで回答ログを上書きできません');
          }
          // The original write included the stats and session in this same
          // transaction, so an exact retry is already fully committed.
          return;
        }
        transaction.put(MEMORY_STORES.attempts, attempt);
        transaction.put(MEMORY_STORES.sessions, session);
        for (const stat of stats) transaction.put(MEMORY_STORES.stats, stat);
        await replacePendingMutation(transaction, sessionMutation);
      },
    );
  }

  async setManualWeak(
    targetType: MemoryStat['targetType'],
    targetId: string,
    mode: MemoryStat['mode'],
    manualWeak: boolean,
  ): Promise<MemoryStat> {
    const clientId = await this.clientId();
    const id = statId(targetType, targetId, mode);
    return this.store.transaction(
      [MEMORY_STORES.stats, MEMORY_STORES.pendingMutations, MEMORY_STORES.meta],
      'readwrite',
      async (transaction) => {
        const existing = await transaction.get<MemoryStat>(MEMORY_STORES.stats, id);
        if (existing?.manualWeak === manualWeak) return existing;
        const now = new Date().toISOString();
        const baseRevision = existing?.revision ?? 0;
        const previousScore = existing?.weaknessScore ?? 0;
        const next: MemoryStat = {
          id,
          targetType,
          targetId,
          mode,
          attempts: existing?.attempts ?? 0,
          correctCount: existing?.correctCount ?? 0,
          partialCount: existing?.partialCount ?? 0,
          incorrectCount: existing?.incorrectCount ?? 0,
          skippedCount: existing?.skippedCount ?? 0,
          consecutiveCorrect: existing?.consecutiveCorrect ?? 0,
          consecutiveIncorrect: existing?.consecutiveIncorrect ?? 0,
          averageResponseMs: existing?.averageResponseMs ?? 0,
          hintCount: existing?.hintCount ?? 0,
          manualWeak,
          weaknessScore: Math.min(100, Math.max(0, previousScore + (manualWeak ? 8 : -8))),
          ...(existing?.lastAttemptAt ? { lastAttemptAt: existing.lastAttemptAt } : {}),
          updatedAt: now,
          revision: baseRevision + 1,
        };
        const payload = {
          targetType,
          targetId,
          mode,
          manualWeak,
          updatedAt: now,
        };
        const mutation = mutationFor(clientId, 'stat_preference', id, 'upsert', payload, baseRevision);
        transaction.put(MEMORY_STORES.stats, next);
        await appendPendingMutations(transaction, [mutation]);
        return next;
      },
    );
  }

  async saveSession(session: MemorySession, queueForSync = true): Promise<void> {
    if (!queueForSync) {
      await this.store.put(MEMORY_STORES.sessions, session);
      return;
    }
    const clientId = await this.clientId();
    const mutation = mutationFor(clientId, 'session', session.id, 'upsert', session);
    await this.store.transaction(
      [MEMORY_STORES.sessions, MEMORY_STORES.pendingMutations, MEMORY_STORES.meta],
      'readwrite',
      async (transaction) => {
        transaction.put(MEMORY_STORES.sessions, session);
        await replacePendingMutation(transaction, mutation);
      },
    );
  }

  /** Atomically abandons every older active session and installs one new active session. */
  async startSession(session: MemorySession): Promise<void> {
    const clientId = await this.clientId();
    await this.store.transaction(
      [MEMORY_STORES.sessions, MEMORY_STORES.pendingMutations, MEMORY_STORES.meta],
      'readwrite',
      async (transaction) => {
        const activeSessions = await transaction.getAllFromIndex<MemorySession>(
          MEMORY_STORES.sessions,
          'status',
          'active',
        );
        const now = new Date().toISOString();
        for (const activeSession of activeSessions) {
          if (activeSession.id === session.id) continue;
          const abandoned: MemorySession = {
            ...activeSession,
            status: 'abandoned',
            updatedAt: now,
            completedAt: undefined,
          };
          transaction.put(MEMORY_STORES.sessions, abandoned);
          await replacePendingMutation(
            transaction,
            mutationFor(clientId, 'session', abandoned.id, 'upsert', abandoned),
          );
        }
        transaction.put(MEMORY_STORES.sessions, session);
        await replacePendingMutation(
          transaction,
          mutationFor(clientId, 'session', session.id, 'upsert', session),
        );
      },
    );
  }

  async getSession(sessionId: string): Promise<MemorySession | undefined> {
    return this.store.get<MemorySession>(MEMORY_STORES.sessions, sessionId);
  }

  async getActiveSession(): Promise<MemorySession | undefined> {
    const sessions = await this.store.getAllFromIndex<MemorySession>(MEMORY_STORES.sessions, 'status', 'active');
    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  }

  async listSessions(limit = 20): Promise<MemorySession[]> {
    const sessions = await this.store.getAll<MemorySession>(MEMORY_STORES.sessions);
    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, limit);
  }

  async getSessionAttempts(sessionId: string): Promise<LocalMemoryAttempt[]> {
    const attempts = await this.store.getAllFromIndex<LocalMemoryAttempt>(MEMORY_STORES.attempts, 'sessionId', sessionId);
    return attempts.filter((attempt) => !attempt.undoneAt).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async getTargetAttempts(targetId: string, limit = 50): Promise<LocalMemoryAttempt[]> {
    const attempts = await this.store.getAllFromIndex<LocalMemoryAttempt>(MEMORY_STORES.attempts, 'targetId', targetId);
    return attempts
      .filter((attempt) => !attempt.undoneAt)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async getStatTargetAttempts(
    targetType: MemoryStat['targetType'],
    targetId: string,
    modeOrLimit: MemoryStat['mode'] | number = 50,
    requestedLimit = 50,
  ): Promise<LocalMemoryAttempt[]> {
    const mode = typeof modeOrLimit === 'string' ? modeOrLimit : undefined;
    const limit = typeof modeOrLimit === 'number' ? modeOrLimit : requestedLimit;
    const indexName = targetType === 'sense' ? 'senseId' : targetType === 'answer' ? 'answerId' : 'exerciseId';
    const attempts = await this.store.getAllFromIndex<LocalMemoryAttempt>(MEMORY_STORES.attempts, indexName, targetId);
    return attempts
      .filter((attempt) => !attempt.undoneAt && (!mode || attempt.mode === mode))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async unsyncedAttempts(limit = 20): Promise<LocalMemoryAttempt[]> {
    const [attempts, conflicts] = await Promise.all([
      this.store.getAll<LocalMemoryAttempt>(MEMORY_STORES.attempts),
      this.store.getAll<MemoryConflict>(MEMORY_STORES.conflicts),
    ]);
    const blocked = new Set(
      conflicts.filter((conflict) => !conflict.resolvedAt).map((conflict) => conflict.entityKey),
    );
    const blockedStats = new Set(
      conflicts
        .filter((conflict) => !conflict.resolvedAt && conflict.entityType === 'stat_preference')
        .map((conflict) => conflict.entityId),
    );
    return attempts
      .filter((attempt) => {
        if (attempt.syncedAt) return false;
        const entityKeys = [
          entityIdentity('item', attempt.itemId),
          entityIdentity('sense', attempt.senseId),
          entityIdentity('session', attempt.sessionId),
          ...(attempt.answerId ? [entityIdentity('answer', attempt.answerId)] : []),
          ...(attempt.exerciseId ? [entityIdentity('exercise', attempt.exerciseId)] : []),
        ];
        return entityKeys.every((key) => !blocked.has(key))
          && statIdsForAttempt(attempt).every((id) => !blockedStats.has(id));
      })
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit);
  }

  async undoAttempt(attemptId: string, restoredStats: MemoryStat[], restoredSession: MemorySession): Promise<void> {
    const clientId = await this.clientId();
    const sessionMutation = mutationFor(clientId, 'session', restoredSession.id, 'upsert', restoredSession);
    await this.store.transaction(
      [
        MEMORY_STORES.attempts,
        MEMORY_STORES.sessions,
        MEMORY_STORES.stats,
        MEMORY_STORES.pendingMutations,
        MEMORY_STORES.meta,
      ],
      'readwrite',
      async (transaction) => {
        const attempt = await transaction.get<LocalMemoryAttempt>(MEMORY_STORES.attempts, attemptId);
        if (!attempt) throw new Error('取り消せる回答が見つかりません');
        if (attempt.undoneAt) throw new Error('この回答はすでに取り消されています');
        const undoneAt = new Date().toISOString();
        const voided = { ...attempt, undoneAt };
        const voidMutation = mutationFor(clientId, 'attempt_void', attemptId, 'upsert', { attemptId, undoneAt });
        transaction.put(MEMORY_STORES.sessions, restoredSession);
        for (const stat of restoredStats) transaction.put(MEMORY_STORES.stats, stat);
        transaction.put(MEMORY_STORES.attempts, voided);
        // Keep even an unsynced attempt as an append-only, locally voided row. If
        // an upload was already in flight, the original append is sent first and
        // this idempotent void follows it.
        await replacePendingMutation(transaction, sessionMutation);
        await appendPendingMutations(transaction, [voidMutation]);
      },
    );
  }

  async pendingMutations(limit = 100): Promise<MemoryPendingMutation[]> {
    const rows = await this.store.getAll<MemoryPendingMutation>(MEMORY_STORES.pendingMutations);
    return sortPendingMutationsForSync(rows).slice(0, limit);
  }

  /**
   * 回答ログのバッチ送信とは別に、カード・セット・苦手フラグ等の編集は
   * 保存直後に同期する。session/attempt_void は回答処理で作られるため除外する。
   */
  async hasPendingContentMutations(): Promise<boolean> {
    const rows = await this.syncablePendingMutations(10_000);
    return rows.some((mutation) => mutation.entityType !== 'session' && mutation.entityType !== 'attempt_void');
  }

  async syncablePendingMutations(limit = 100): Promise<MemoryPendingMutation[]> {
    const [rows, conflicts, attempts] = await Promise.all([
      this.store.getAll<MemoryPendingMutation>(MEMORY_STORES.pendingMutations),
      this.store.getAll<MemoryConflict>(MEMORY_STORES.conflicts),
      this.store.getAll<LocalMemoryAttempt>(MEMORY_STORES.attempts),
    ]);
    const blocked = expandBlockedEntityKeys(
      rows,
      conflicts.filter((conflict) => !conflict.resolvedAt).map((conflict) => conflict.entityKey),
    );
    const unsyncedAttempts = new Set(attempts.filter((attempt) => !attempt.syncedAt).map((attempt) => attempt.attemptId));
    return sortPendingMutationsForSync(rows.filter((mutation) => {
      if (blocked.has(mutation.entityKey)) return false;
      if (mutation.entityType !== 'attempt_void') return true;
      const attemptId = payloadRecord(mutation).attemptId;
      return typeof attemptId !== 'string' || !unsyncedAttempts.has(attemptId);
    })).slice(0, limit);
  }

  async markSynced(mutationIds: string[], attemptIds: string[], syncedAt: string): Promise<void> {
    await this.store.transaction(
      [MEMORY_STORES.pendingMutations, MEMORY_STORES.attempts],
      'readwrite',
      async (transaction) => {
        for (const mutationId of mutationIds) transaction.delete(MEMORY_STORES.pendingMutations, mutationId);
        for (const attemptId of attemptIds) {
          const attempt = await transaction.get<LocalMemoryAttempt>(MEMORY_STORES.attempts, attemptId);
          if (attempt) transaction.put(MEMORY_STORES.attempts, { ...attempt, syncedAt });
        }
      },
    );
  }

  async addConflicts(conflicts: MemoryConflict[]): Promise<void> {
    await this.store.write(conflicts.map((conflict) => ({ store: MEMORY_STORES.conflicts, type: 'put', value: conflict })));
  }

  async listConflicts(): Promise<MemoryConflict[]> {
    const conflicts = await this.store.getAll<MemoryConflict>(MEMORY_STORES.conflicts);
    return conflicts.filter((conflict) => !conflict.resolvedAt).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async resolveConflict(id: string, resolution: NonNullable<MemoryConflict['resolution']>): Promise<void> {
    const conflict = await this.store.get<MemoryConflict>(MEMORY_STORES.conflicts, id);
    if (!conflict) return;
    await this.store.put(MEMORY_STORES.conflicts, {
      ...conflict,
      resolution,
      resolvedAt: new Date().toISOString(),
    });
  }

  async resolveConflictWithServer(id: string): Promise<void> {
    const stores = [...new Set<MemoryStoreName>([
      ...Object.values(ENTITY_STORES),
      MEMORY_STORES.stats,
      MEMORY_STORES.attempts,
      MEMORY_STORES.pendingMutations,
      MEMORY_STORES.conflicts,
    ])];
    await this.store.transaction(stores, 'readwrite', async (transaction) => {
      const conflict = await transaction.get<MemoryConflict>(MEMORY_STORES.conflicts, id);
      if (!conflict || conflict.resolvedAt) return;
      const [pending, conflicts] = await Promise.all([
        transaction.getAll<MemoryPendingMutation>(MEMORY_STORES.pendingMutations),
        transaction.getAll<MemoryConflict>(MEMORY_STORES.conflicts),
      ]);
      for (const mutation of pending) {
        if (mutation.entityKey === conflict.entityKey) transaction.delete(MEMORY_STORES.pendingMutations, mutation.mutationId);
      }
      const resolvedAt = new Date().toISOString();
      for (const related of conflicts) {
        if (related.entityKey === conflict.entityKey && !related.resolvedAt) {
          transaction.put(MEMORY_STORES.conflicts, { ...related, resolution: 'server', resolvedAt });
        }
      }

      if (conflict.entityType === 'attempt_void') {
        const serverAttempt = conflict.serverValue;
        if (serverAttempt && typeof serverAttempt === 'object'
          && typeof (serverAttempt as { attemptId?: unknown }).attemptId === 'string') {
          transaction.put(MEMORY_STORES.attempts, serverAttempt);
        } else {
          transaction.delete(MEMORY_STORES.attempts, conflict.entityId);
        }
        return;
      }
      if (conflict.entityType === 'stat_preference') {
        const server = conflict.serverValue && typeof conflict.serverValue === 'object'
          ? conflict.serverValue as Record<string, unknown>
          : undefined;
        if (!server) return;
        if (typeof server.id === 'string' && typeof server.attempts === 'number') {
          transaction.put(MEMORY_STORES.stats, server);
          return;
        }
        const current = await transaction.get<MemoryStat>(MEMORY_STORES.stats, conflict.entityId);
        if (current && typeof server.manualWeak === 'boolean') {
          transaction.put(MEMORY_STORES.stats, {
            ...current,
            manualWeak: server.manualWeak,
            ...(typeof server.updatedAt === 'string' ? { updatedAt: server.updatedAt } : {}),
            ...(typeof server.revision === 'number' ? { revision: server.revision } : {}),
          });
        }
        return;
      }
      const store = ENTITY_STORES[conflict.entityType];
      const key: IDBValidKey = conflict.entityType === 'set_member'
        ? conflict.entityId.split(':', 2)
        : conflict.entityId;
      if (conflict.serverValue && typeof conflict.serverValue === 'object') {
        transaction.put(store, conflict.serverValue);
      } else {
        transaction.delete(store, key);
      }
    });
  }

  async resolveConflictWithLocal(id: string, mergedValue?: unknown): Promise<void> {
    const clientId = await this.clientId();
    const stores = [...new Set<MemoryStoreName>([
      ...Object.values(ENTITY_STORES),
      MEMORY_STORES.stats,
      MEMORY_STORES.pendingMutations,
      MEMORY_STORES.conflicts,
      MEMORY_STORES.meta,
    ])];
    await this.store.transaction(stores, 'readwrite', async (transaction) => {
      const conflict = await transaction.get<MemoryConflict>(MEMORY_STORES.conflicts, id);
      if (!conflict || conflict.resolvedAt) return;
      const [pending, conflicts, counter] = await Promise.all([
        transaction.getAll<MemoryPendingMutation>(MEMORY_STORES.pendingMutations),
        transaction.getAll<MemoryConflict>(MEMORY_STORES.conflicts),
        transaction.get<{ key: string; value: number }>(MEMORY_STORES.meta, 'nextMutationSequence'),
      ]);
      const relatedPending = sortPendingMutationsForSync(
        pending.filter((mutation) => mutation.entityKey === conflict.entityKey),
      );
      const desired = mergedValue
        ?? relatedPending[relatedPending.length - 1]?.payload
        ?? conflict.localValue;
      if (!desired || typeof desired !== 'object' || Array.isArray(desired)) {
        throw new Error('競合したローカルデータを再適用できません');
      }
      for (const mutation of relatedPending) transaction.delete(MEMORY_STORES.pendingMutations, mutation.mutationId);

      const resolvedAt = new Date().toISOString();
      for (const related of conflicts) {
        if (related.entityKey === conflict.entityKey && !related.resolvedAt) {
          transaction.put(MEMORY_STORES.conflicts, { ...related, resolution: 'local', resolvedAt });
        }
      }

      const now = new Date().toISOString();
      const server = conflict.serverValue && typeof conflict.serverValue === 'object' && !Array.isArray(conflict.serverValue)
        ? conflict.serverValue as Record<string, unknown>
        : undefined;
      const local = { ...(desired as Record<string, unknown>) };
      const revisioned = ['item', 'sense', 'answer', 'example', 'exercise', 'set'].includes(conflict.entityType);
      let operation: MemoryMutationOperation = 'upsert';
      let baseRevision: number | undefined;
      let mutationPayload: unknown = local;

      if (conflict.entityType === 'stat_preference') {
        const current = await transaction.get<MemoryStat>(MEMORY_STORES.stats, conflict.entityId);
        const targetType = local.targetType ?? current?.targetType;
        const targetId = local.targetId ?? current?.targetId;
        const mode = local.mode ?? current?.mode;
        if ((targetType !== 'sense' && targetType !== 'answer' && targetType !== 'exercise')
          || typeof targetId !== 'string'
          || (mode !== 'input' && mode !== 'output' && mode !== 'context' && mode !== 'composition')
          || typeof local.manualWeak !== 'boolean') {
          throw new Error('競合した苦手設定を再適用できません');
        }
        const serverRevision = revisionOf(server) ?? conflict.baseRevision ?? current?.revision ?? 0;
        const nextRevision = serverRevision + 1;
        const previousScore = current?.weaknessScore ?? 0;
        const nextStat: MemoryStat = {
          id: conflict.entityId,
          targetType,
          targetId,
          mode,
          attempts: current?.attempts ?? 0,
          correctCount: current?.correctCount ?? 0,
          partialCount: current?.partialCount ?? 0,
          incorrectCount: current?.incorrectCount ?? 0,
          skippedCount: current?.skippedCount ?? 0,
          consecutiveCorrect: current?.consecutiveCorrect ?? 0,
          consecutiveIncorrect: current?.consecutiveIncorrect ?? 0,
          averageResponseMs: current?.averageResponseMs ?? 0,
          hintCount: current?.hintCount ?? 0,
          manualWeak: local.manualWeak,
          weaknessScore: Math.min(100, Math.max(
            0,
            previousScore + (local.manualWeak === current?.manualWeak ? 0 : local.manualWeak ? 8 : -8),
          )),
          ...(current?.lastAttemptAt ? { lastAttemptAt: current.lastAttemptAt } : {}),
          updatedAt: now,
          revision: nextRevision,
        };
        transaction.put(MEMORY_STORES.stats, nextStat);
        local.targetType = targetType;
        local.targetId = targetId;
        local.mode = mode;
        local.updatedAt = now;
        mutationPayload = {
          targetType,
          targetId,
          mode,
          manualWeak: local.manualWeak,
          updatedAt: now,
        };
        operation = 'upsert';
        baseRevision = serverRevision;
      } else if (revisioned) {
        if (!server) {
          // Deleting a server record that no longer exists is already satisfied.
          if (typeof local.deletedAt === 'string') return;
          local.revision = 1;
          local.updatedAt = now;
          operation = 'create';
          baseRevision = 0;
        } else {
          const serverRevision = revisionOf(server);
          if (serverRevision === undefined) throw new Error('サーバー版のrevisionが不正です');
          local.revision = serverRevision + 1;
          local.updatedAt = now;
          local.createdAt = server.createdAt;
          if (typeof server.source === 'string') local.source = server.source;
          if (server.verificationStatus === 'verified') local.verificationStatus = 'verified';
          for (const relation of relationKeysForClient(conflict.entityType)) local[relation] = server[relation];
          operation = typeof local.deletedAt === 'string' ? 'delete' : 'update';
          baseRevision = serverRevision;
        }
      } else if (conflict.entityType === 'session') {
        local.updatedAt = now;
      }

      if (conflict.entityType !== 'attempt_void' && conflict.entityType !== 'stat_preference') {
        const store = ENTITY_STORES[conflict.entityType];
        transaction.put(store, local);
      }
      const mutation = mutationFor(
        clientId,
        conflict.entityType,
        conflict.entityId,
        operation,
        mutationPayload,
        baseRevision,
      );
      const sequence = Number.isSafeInteger(counter?.value) && (counter?.value ?? 0) > 0 ? counter!.value : 1;
      transaction.put(MEMORY_STORES.pendingMutations, { ...mutation, localSequence: sequence });
      transaction.put(MEMORY_STORES.meta, { key: 'nextMutationSequence', value: sequence + 1 });
    });
  }

  async applyRemoteChanges(changes: RemoteMemoryChanges): Promise<void> {
    const stores = [...new Set<MemoryStoreName>([
      ...Object.values(ENTITY_STORES),
      MEMORY_STORES.stats,
      MEMORY_STORES.attempts,
      MEMORY_STORES.pendingMutations,
      MEMORY_STORES.conflicts,
    ])];
    await this.store.transaction(stores, 'readwrite', async (transaction) => {
      const [pending, conflicts, attempts] = await Promise.all([
        transaction.getAll<MemoryPendingMutation>(MEMORY_STORES.pendingMutations),
        transaction.getAll<MemoryConflict>(MEMORY_STORES.conflicts),
        transaction.getAll<LocalMemoryAttempt>(MEMORY_STORES.attempts),
      ]);
      const blocked = new Set([
        ...pending.map((mutation) => mutation.entityKey),
        ...conflicts.filter((conflict) => !conflict.resolvedAt).map((conflict) => conflict.entityKey),
      ]);
      const blockedStatIds = new Set<string>();
      for (const mutation of pending) {
        const id = statPreferenceId(mutation);
        if (id) blockedStatIds.add(id);
      }
      for (const conflict of conflicts) {
        if (!conflict.resolvedAt && conflict.entityType === 'stat_preference') blockedStatIds.add(conflict.entityId);
      }
      for (const attempt of attempts) {
        if (!attempt.syncedAt) statIdsForAttempt(attempt).forEach((id) => blockedStatIds.add(id));
      }
      await applyRemoteChangesInTransaction(transaction, changes, blocked, blockedStatIds);
    });
  }

  /**
   * Commits one server response as a single local transaction: remote records,
   * conflict rows, accepted queue removals, attempt receipts and cursor always
   * advance together.
   */
  async commitSyncResponse(response: MemorySyncCommit): Promise<void> {
    const stores = [...new Set<MemoryStoreName>([
      ...Object.values(ENTITY_STORES),
      MEMORY_STORES.stats,
      MEMORY_STORES.attempts,
      MEMORY_STORES.pendingMutations,
      MEMORY_STORES.conflicts,
      MEMORY_STORES.meta,
    ])];
    await this.store.transaction(stores, 'readwrite', async (transaction) => {
      const [pending, storedConflicts, cursorRow, localAttempts] = await Promise.all([
        transaction.getAll<MemoryPendingMutation>(MEMORY_STORES.pendingMutations),
        transaction.getAll<MemoryConflict>(MEMORY_STORES.conflicts),
        transaction.get<{ key: string; value: string }>(MEMORY_STORES.meta, 'syncCursor'),
        transaction.getAll<LocalMemoryAttempt>(MEMORY_STORES.attempts),
      ]);
      const acceptedMutationIds = new Set(response.acceptedMutationIds);
      for (const mutationId of acceptedMutationIds) transaction.delete(MEMORY_STORES.pendingMutations, mutationId);
      for (const conflict of response.conflicts) transaction.put(MEMORY_STORES.conflicts, conflict);

      const remaining = pending.filter((mutation) => !acceptedMutationIds.has(mutation.mutationId));
      const blockedEntityKeys = new Set([
        ...remaining.map((mutation) => mutation.entityKey),
        ...storedConflicts.filter((conflict) => !conflict.resolvedAt).map((conflict) => conflict.entityKey),
        ...response.conflicts.map((conflict) => conflict.entityKey),
      ]);

      const acceptedAttemptIds = new Set(response.acceptedAttemptIds);
      const locallyDirtyAttemptIds = new Set(response.sentAttemptIds.filter((id) => !acceptedAttemptIds.has(id)));
      for (const mutation of remaining) {
        if (mutation.entityType !== 'attempt_void') continue;
        const attemptId = payloadRecord(mutation).attemptId;
        if (typeof attemptId === 'string') locallyDirtyAttemptIds.add(attemptId);
      }
      const blockedStatIds = new Set<string>();
      for (const mutation of remaining) {
        const id = statPreferenceId(mutation);
        if (id) blockedStatIds.add(id);
      }
      for (const conflict of [...storedConflicts, ...response.conflicts]) {
        if (!conflict.resolvedAt && conflict.entityType === 'stat_preference') blockedStatIds.add(conflict.entityId);
      }
      for (const attempt of localAttempts) {
        if (!attempt.syncedAt && !acceptedAttemptIds.has(attempt.attemptId)) {
          statIdsForAttempt(attempt).forEach((id) => blockedStatIds.add(id));
        }
      }
      for (const attemptId of locallyDirtyAttemptIds) {
        const attempt = localAttempts.find((candidate) => candidate.attemptId === attemptId);
        if (!attempt) continue;
        statIdsForAttempt(attempt).forEach((id) => blockedStatIds.add(id));
      }

      await applyRemoteChangesInTransaction(transaction, response.changes, blockedEntityKeys, blockedStatIds);
      for (const attemptId of acceptedAttemptIds) {
        const attempt = await transaction.get<LocalMemoryAttempt>(MEMORY_STORES.attempts, attemptId);
        if (attempt) transaction.put(MEMORY_STORES.attempts, { ...attempt, syncedAt: response.serverTime });
      }

      const currentCursor = cursorRow && /^\d+$/u.test(cursorRow.value) ? Number(cursorRow.value) : 0;
      const responseCursor = /^\d+$/u.test(response.cursor) ? Number(response.cursor) : currentCursor;
      transaction.put(MEMORY_STORES.meta, {
        key: 'syncCursor',
        value: String(Math.max(currentCursor, responseCursor)),
      });
    });
  }

  async syncCursor(): Promise<string | undefined> {
    return this.store.getMeta<string>('syncCursor');
  }

  async setSyncCursor(cursor: string): Promise<void> {
    await this.store.setMeta('syncCursor', cursor);
  }

  async exportAll(): Promise<{
    snapshot: MemoryLocalSnapshot;
    attempts: LocalMemoryAttempt[];
    sessions: MemorySession[];
  }> {
    const [items, senses, answers, examples, exercises, sets, setMembers, stats, attempts, sessions] = await Promise.all([
      this.store.getAll<MemoryItem>(MEMORY_STORES.items),
      this.store.getAll<MemorySense>(MEMORY_STORES.senses),
      this.store.getAll<MemoryAnswer>(MEMORY_STORES.answers),
      this.store.getAll<MemoryExample>(MEMORY_STORES.examples),
      this.store.getAll<MemoryExercise>(MEMORY_STORES.exercises),
      this.store.getAll<MemorySet>(MEMORY_STORES.sets),
      this.store.getAll<MemorySetMember>(MEMORY_STORES.setMembers),
      this.store.getAll<MemoryStat>(MEMORY_STORES.stats),
      this.store.getAll<LocalMemoryAttempt>(MEMORY_STORES.attempts),
      this.store.getAll<MemorySession>(MEMORY_STORES.sessions),
    ]);
    // Full backup intentionally includes tombstones and voided Attempts. Active
    // UI snapshots filter them, but omitting them here can make historical
    // Attempts reference missing parents and loses cross-device delete/undo state.
    return {
      snapshot: { items, senses, answers, examples, exercises, sets, setMembers, stats },
      attempts,
      sessions,
    };
  }

  async replaceFromBackup(data: {
    snapshot: MemoryLocalSnapshot;
    attempts: LocalMemoryAttempt[];
    sessions: MemorySession[];
  }): Promise<void> {
    const clientId = await this.clientId();
    const restoredAt = new Date().toISOString();
    const stores = Object.values(MEMORY_STORES);
    const pending: MemoryPendingMutation[] = [];
    const bumpRevision = <T extends { revision: number; updatedAt: string }>(row: T): T => ({
      ...row,
      revision: row.revision + 1,
      updatedAt: restoredAt,
    });
    // A backup contains the last revision it observed. Restoring expresses a new
    // local write based on that revision: same-revision servers accept it, while
    // servers advanced since export produce an explicit conflict.
    const restoredSnapshot: MemoryLocalSnapshot = {
      ...data.snapshot,
      items: data.snapshot.items.map(bumpRevision),
      senses: data.snapshot.senses.map(bumpRevision),
      answers: data.snapshot.answers.map(bumpRevision),
      examples: data.snapshot.examples.map(bumpRevision),
      exercises: data.snapshot.exercises.map(bumpRevision),
      sets: data.snapshot.sets.map(bumpRevision),
    };
    const restoredStats = data.snapshot.stats.map((stat) => ({
      ...stat,
      revision: (stat.revision ?? 0) + 1,
      updatedAt: restoredAt,
    }));
    const queueRevisioned = (
      entityType: 'item' | 'sense' | 'answer' | 'example' | 'exercise' | 'set',
      rows: Array<{ id: string; revision: number; deletedAt?: string }>,
    ) => {
      for (const row of rows) {
        const operation: MemoryMutationOperation = row.deletedAt
          ? 'delete'
          : row.revision <= 1 ? 'create' : 'update';
        pending.push(mutationFor(
          clientId,
          entityType,
          row.id,
          operation,
          row,
          operation === 'create' ? 0 : Math.max(1, row.revision - 1),
        ));
      }
    };
    queueRevisioned('item', restoredSnapshot.items);
    queueRevisioned('sense', restoredSnapshot.senses);
    queueRevisioned('answer', restoredSnapshot.answers);
    queueRevisioned('example', restoredSnapshot.examples);
    queueRevisioned('exercise', restoredSnapshot.exercises);
    queueRevisioned('set', restoredSnapshot.sets);
    for (const member of restoredSnapshot.setMembers) {
      pending.push(mutationFor(
        clientId, 'set_member', `${member.setId}:${member.itemId}`, 'upsert', member,
      ));
    }
    for (const session of data.sessions) {
      pending.push(mutationFor(clientId, 'session', session.id, 'upsert', session));
    }
    for (const stat of restoredStats) {
      const baseRevision = (stat.revision ?? 1) - 1;
      pending.push(mutationFor(
        clientId,
        'stat_preference',
        stat.id,
        'upsert',
        {
          targetType: stat.targetType,
          targetId: stat.targetId,
          mode: stat.mode,
          manualWeak: stat.manualWeak,
          updatedAt: stat.updatedAt,
        },
        baseRevision,
      ));
    }
    for (const attempt of data.attempts) {
      if (!attempt.undoneAt) continue;
      pending.push(mutationFor(
        clientId,
        'attempt_void',
        attempt.attemptId,
        'upsert',
        { attemptId: attempt.attemptId, undoneAt: attempt.undoneAt },
      ));
    }

    await this.store.transaction(stores, 'readwrite', async (transaction) => {
      for (const store of stores) transaction.clear(store);
      const putAll = (store: MemoryStoreName, rows: unknown[]) => {
        for (const row of rows) transaction.put(store, row);
      };
      putAll(MEMORY_STORES.items, restoredSnapshot.items);
      putAll(MEMORY_STORES.senses, restoredSnapshot.senses);
      putAll(MEMORY_STORES.answers, restoredSnapshot.answers);
      putAll(MEMORY_STORES.examples, restoredSnapshot.examples);
      putAll(MEMORY_STORES.exercises, restoredSnapshot.exercises);
      putAll(MEMORY_STORES.sets, restoredSnapshot.sets);
      putAll(MEMORY_STORES.setMembers, restoredSnapshot.setMembers);
      putAll(MEMORY_STORES.stats, restoredStats);
      putAll(MEMORY_STORES.sessions, data.sessions);
      for (const attempt of data.attempts) {
        const restored = { ...attempt };
        delete restored.syncedAt;
        transaction.put(MEMORY_STORES.attempts, restored);
      }
      pending.forEach((mutation, index) => {
        transaction.put(MEMORY_STORES.pendingMutations, { ...mutation, localSequence: index + 1 });
      });
      transaction.put(MEMORY_STORES.meta, { key: 'clientId', value: clientId });
      transaction.put(MEMORY_STORES.meta, { key: 'nextMutationSequence', value: pending.length + 1 });
      transaction.put(MEMORY_STORES.meta, { key: 'syncCursor', value: '0' });
    });
  }

  close(): void {
    this.store.close();
  }
}
