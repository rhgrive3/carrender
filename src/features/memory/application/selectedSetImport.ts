import {
  parseSelectedSetExport,
  type SelectedSetExport,
} from '../domain/importExport';
import type { MemorySetMember, MemoryStat } from '../domain/types';
import {
  MEMORY_STORES,
  type MemoryStoreName,
  type MemoryWriteOperation,
  type MemoryWritePrecondition,
} from '../infrastructure/indexedDb';
import {
  createMemoryId,
  type MemoryEntityType,
  type MemoryLocalSnapshot,
  type MemoryPendingMutation,
  type MemoryRepository,
} from '../infrastructure/repositories';

export type SelectedSetImportEntityType =
  | 'set'
  | 'set_member'
  | 'item'
  | 'sense'
  | 'answer'
  | 'example'
  | 'exercise'
  | 'stat';

export interface SelectedSetImportConflict {
  entityType: SelectedSetImportEntityType;
  entityId: string;
  reason: 'content_mismatch' | 'revision_conflict' | 'cross_type_id' | 'identity_conflict';
  incoming: unknown;
  existing: unknown;
}

export interface SelectedSetImportPreview {
  document: SelectedSetExport;
  additions: number;
  identical: number;
  conflicts: SelectedSetImportConflict[];
  statsAvailable: number;
  additionsByType: Record<SelectedSetImportEntityType, number>;
}

interface ImportRecord {
  entityType: Exclude<SelectedSetImportEntityType, 'stat'>;
  entityId: string;
  value: unknown;
  store: MemoryStoreName;
}

const EMPTY_COUNTS: Record<SelectedSetImportEntityType, number> = {
  set: 0,
  set_member: 0,
  item: 0,
  sense: 0,
  answer: 0,
  example: 0,
  exercise: 0,
  stat: 0,
};

const CONTENT_ENTITY_TYPES = ['item', 'sense', 'answer', 'example', 'exercise'] as const;

function memberId(member: MemorySetMember): string {
  return `${member.setId}:${member.itemId}`;
}

function statIdentity(stat: Pick<MemoryStat, 'targetType' | 'targetId' | 'mode'>): string {
  return `${stat.targetType}:${stat.targetId}:${stat.mode}`;
}

function documentRecords(document: SelectedSetExport): ImportRecord[] {
  return [
    ...document.sets.map((value) => ({ entityType: 'set' as const, entityId: value.id, value, store: MEMORY_STORES.sets })),
    ...document.items.map((value) => ({ entityType: 'item' as const, entityId: value.id, value, store: MEMORY_STORES.items })),
    ...document.senses.map((value) => ({ entityType: 'sense' as const, entityId: value.id, value, store: MEMORY_STORES.senses })),
    ...document.answers.map((value) => ({ entityType: 'answer' as const, entityId: value.id, value, store: MEMORY_STORES.answers })),
    ...document.examples.map((value) => ({ entityType: 'example' as const, entityId: value.id, value, store: MEMORY_STORES.examples })),
    ...document.exercises.map((value) => ({ entityType: 'exercise' as const, entityId: value.id, value, store: MEMORY_STORES.exercises })),
    ...document.setMembers.map((value) => ({ entityType: 'set_member' as const, entityId: memberId(value), value, store: MEMORY_STORES.setMembers })),
  ];
}

function snapshotRecords(snapshot: MemoryLocalSnapshot): Map<SelectedSetImportEntityType, Map<string, unknown>> {
  return new Map([
    ['set', new Map(snapshot.sets.map((value) => [value.id, value]))],
    ['set_member', new Map(snapshot.setMembers.map((value) => [memberId(value), value]))],
    ['item', new Map(snapshot.items.map((value) => [value.id, value]))],
    ['sense', new Map(snapshot.senses.map((value) => [value.id, value]))],
    ['answer', new Map(snapshot.answers.map((value) => [value.id, value]))],
    ['example', new Map(snapshot.examples.map((value) => [value.id, value]))],
    ['exercise', new Map(snapshot.exercises.map((value) => [value.id, value]))],
    ['stat', new Map(snapshot.stats.map((value) => [value.id, value]))],
  ] as Array<[SelectedSetImportEntityType, Map<string, unknown>]>);
}

function snapshotStatsByIdentity(snapshot: MemoryLocalSnapshot): Map<string, MemoryStat> {
  return new Map(snapshot.stats.map((stat) => [statIdentity(stat), stat]));
}

function comparable(value: unknown, ignoreRevision: boolean): unknown {
  if (Array.isArray(value)) return value.map((entry) => comparable(entry, false));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key, entry]) => entry !== undefined && (!ignoreRevision || (key !== 'revision' && key !== 'updatedAt')))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, comparable(entry, false)]),
  );
}

function sameRecord(entityType: SelectedSetImportEntityType, left: unknown, right: unknown): boolean {
  const ignoreRevision = entityType !== 'set_member' && entityType !== 'stat';
  return JSON.stringify(comparable(left, ignoreRevision)) === JSON.stringify(comparable(right, ignoreRevision));
}

function revision(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = (value as { revision?: unknown }).revision;
  return typeof candidate === 'number' ? candidate : undefined;
}

/** Builds a read-only collision preview. No ID is regenerated or overwritten. */
export function previewSelectedSetImport(
  document: SelectedSetExport,
  existing: MemoryLocalSnapshot,
): SelectedSetImportPreview {
  const existingByType = snapshotRecords(existing);
  const existingStatsByIdentity = snapshotStatsByIdentity(existing);
  const additionsByType = { ...EMPTY_COUNTS };
  const conflicts: SelectedSetImportConflict[] = [];
  let identical = 0;

  const inspect = (entityType: SelectedSetImportEntityType, entityId: string, incoming: unknown): void => {
    const localType = CONTENT_ENTITY_TYPES.includes(entityType as typeof CONTENT_ENTITY_TYPES[number])
      ? CONTENT_ENTITY_TYPES.find((type) => type !== entityType && existingByType.get(type)?.has(entityId))
      : undefined;
    if (localType) {
      conflicts.push({
        entityType,
        entityId,
        reason: 'cross_type_id',
        incoming,
        existing: existingByType.get(localType)?.get(entityId),
      });
      return;
    }
    const current = existingByType.get(entityType)?.get(entityId);
    if (current === undefined) {
      additionsByType[entityType] += 1;
      return;
    }
    if (sameRecord(entityType, current, incoming)) {
      identical += 1;
      return;
    }
    const currentRevision = revision(current);
    const incomingRevision = revision(incoming);
    conflicts.push({
      entityType,
      entityId,
      reason: currentRevision !== undefined && incomingRevision !== undefined && currentRevision !== incomingRevision
        ? 'revision_conflict'
        : 'content_mismatch',
      incoming,
      existing: current,
    });
  };

  for (const record of documentRecords(document)) inspect(record.entityType, record.entityId, record.value);
  for (const stat of document.stats ?? []) {
    const currentById = existingByType.get('stat')?.get(stat.id) as MemoryStat | undefined;
    const currentByIdentity = existingStatsByIdentity.get(statIdentity(stat));
    if (currentById && statIdentity(currentById) !== statIdentity(stat)) {
      conflicts.push({
        entityType: 'stat', entityId: stat.id, reason: 'identity_conflict', incoming: stat, existing: currentById,
      });
    } else if (currentByIdentity && currentByIdentity.id !== stat.id) {
      conflicts.push({
        entityType: 'stat', entityId: stat.id, reason: 'identity_conflict', incoming: stat, existing: currentByIdentity,
      });
    } else {
      inspect('stat', stat.id, stat);
    }
  }

  return {
    document,
    additions: Object.entries(additionsByType)
      .filter(([type]) => type !== 'stat')
      .reduce((sum, [, count]) => sum + count, 0),
    identical,
    conflicts,
    statsAvailable: document.stats?.length ?? 0,
    additionsByType,
  };
}

function importedCreateValue(value: unknown, now: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Object.prototype.hasOwnProperty.call(value, 'revision')) return value;
  // revision belongs to the destination account's sync history. The source ID
  // and content are preserved, while a genuinely new destination record starts
  // at revision 1 so the D1 create contract accepts it.
  return { ...(value as Record<string, unknown>), revision: 1, updatedAt: now };
}

function recordKey(record: ImportRecord): IDBValidKey {
  if (record.entityType !== 'set_member') return record.entityId;
  const member = record.value as MemorySetMember;
  return [member.setId, member.itemId];
}

function importPreconditions(
  document: SelectedSetExport,
  snapshot: MemoryLocalSnapshot,
  includeStats: boolean,
): MemoryWritePrecondition[] {
  const existingByType = snapshotRecords(snapshot);
  const statsByIdentity = snapshotStatsByIdentity(snapshot);
  const preconditions = new Map<string, MemoryWritePrecondition>();
  const add = (precondition: MemoryWritePrecondition): void => {
    const identity = `${precondition.store}:${precondition.indexName ?? 'primary'}:${JSON.stringify(precondition.key)}`;
    preconditions.set(identity, precondition);
  };

  for (const record of documentRecords(document)) {
    add({
      store: record.store,
      key: recordKey(record),
      expected: existingByType.get(record.entityType)?.get(record.entityId),
    });
    // Cross-type content IDs are part of the preview decision too. Ensure a
    // colliding record cannot appear in another store before this commit.
    if (CONTENT_ENTITY_TYPES.includes(record.entityType as typeof CONTENT_ENTITY_TYPES[number])) {
      for (const entityType of CONTENT_ENTITY_TYPES) {
        add({
          store: documentRecordsStore(entityType),
          key: record.entityId,
          expected: existingByType.get(entityType)?.get(record.entityId),
        });
      }
    }
  }
  if (includeStats) {
    for (const stat of document.stats ?? []) {
      add({ store: MEMORY_STORES.stats, key: stat.id, expected: existingByType.get('stat')?.get(stat.id) });
      add({
        store: MEMORY_STORES.stats,
        indexName: 'target',
        key: [stat.targetType, stat.targetId, stat.mode],
        expected: statsByIdentity.get(statIdentity(stat)),
      });
    }
  }
  return [...preconditions.values()];
}

function documentRecordsStore(entityType: typeof CONTENT_ENTITY_TYPES[number]): MemoryStoreName {
  const stores = {
    item: MEMORY_STORES.items,
    sense: MEMORY_STORES.senses,
    answer: MEMORY_STORES.answers,
    example: MEMORY_STORES.examples,
    exercise: MEMORY_STORES.exercises,
  } satisfies Record<typeof CONTENT_ENTITY_TYPES[number], MemoryStoreName>;
  return stores[entityType];
}

function pendingMutation(input: {
  clientId: string;
  entityType: MemoryEntityType;
  entityId: string;
  operation: 'create' | 'upsert';
  payload: unknown;
  baseRevision?: number;
  now: string;
}): MemoryPendingMutation {
  return {
    mutationId: createMemoryId('mut'),
    clientId: input.clientId,
    entityType: input.entityType,
    entityId: input.entityId,
    entityKey: `${input.entityType}:${input.entityId}`,
    operation: input.operation,
    ...(input.baseRevision === undefined ? {} : { baseRevision: input.baseRevision }),
    payload: input.payload,
    createdAt: input.now,
  };
}

export interface SelectedSetImportResult {
  imported: number;
  skippedIdentical: number;
  importedStats: number;
}

/**
 * Revalidates current storage, then writes every new record, optional confirmed
 * Stat, and outbound mutation in one IndexedDB transaction.
 */
export async function importSelectedSetExport(input: {
  repository: MemoryRepository;
  document: SelectedSetExport;
  includeStats?: boolean;
}): Promise<SelectedSetImportResult> {
  const parsed = parseSelectedSetExport(input.document);
  if (!parsed.valid || !parsed.document) {
    throw new Error(parsed.issues[0]?.message ?? '選択セットJSONが不正です');
  }
  if (input.includeStats && !parsed.hasStats) throw new Error('このファイルに統計は含まれていません');

  const current = await input.repository.exportAll();
  const preview = previewSelectedSetImport(parsed.document, current.snapshot);
  const blockingConflicts = preview.conflicts.filter((conflict) => input.includeStats || conflict.entityType !== 'stat');
  if (blockingConflicts.length > 0) {
    const first = blockingConflicts[0];
    throw new Error(`ID ${first.entityId} は端末内の${first.entityType}と内容またはrevisionが異なるため取り込めません`);
  }

  const existingByType = snapshotRecords(current.snapshot);
  const clientId = await input.repository.clientId();
  const now = new Date().toISOString();
  const operations: MemoryWriteOperation[] = [];
  const mutations: MemoryPendingMutation[] = [];
  const preconditions = importPreconditions(parsed.document, current.snapshot, Boolean(input.includeStats));
  let imported = 0;

  for (const record of documentRecords(parsed.document)) {
    if (existingByType.get(record.entityType)?.has(record.entityId)) continue;
    const value = importedCreateValue(record.value, now);
    operations.push({ store: record.store, type: 'put', value });
    const operation = record.entityType === 'set_member' ? 'upsert' : 'create';
    mutations.push(pendingMutation({
      clientId,
      entityType: record.entityType,
      entityId: record.entityId,
      operation,
      payload: value,
      ...(operation === 'create' ? { baseRevision: 0 } : {}),
      now,
    }));
    imported += 1;
  }

  let importedStats = 0;
  if (input.includeStats) {
    for (const stat of parsed.document.stats ?? []) {
      if (existingByType.get('stat')?.has(stat.id)) continue;
      operations.push({ store: MEMORY_STORES.stats, type: 'put', value: stat });
      importedStats += 1;
    }
  }
  await input.repository.store.writeWithPendingMutations(operations, mutations, preconditions);
  return { imported, skippedIdentical: preview.identical, importedStats };
}
