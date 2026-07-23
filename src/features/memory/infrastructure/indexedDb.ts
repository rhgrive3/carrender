const MEMORY_DB_VERSION = 3;

export const MEMORY_STORES = {
  items: 'memoryItems',
  senses: 'memorySenses',
  answers: 'memoryAnswers',
  examples: 'memoryExamples',
  exercises: 'memoryExercises',
  sets: 'memorySets',
  setMembers: 'memorySetMembers',
  stats: 'memoryStats',
  attempts: 'memoryAttempts',
  sessions: 'memorySessions',
  pendingMutations: 'memoryPendingMutations',
  conflicts: 'memoryConflicts',
  meta: 'memoryMeta',
} as const;

export type MemoryStoreName = (typeof MEMORY_STORES)[keyof typeof MEMORY_STORES];

export interface MemoryWriteOperation {
  store: MemoryStoreName;
  type: 'put' | 'delete';
  value?: unknown;
  key?: IDBValidKey;
}

/**
 * Optimistic read condition evaluated in the same transaction as a write.
 * `expected: undefined` explicitly means that the key/index entry must still
 * be absent. This closes the gap between an import preview and its commit.
 */
export interface MemoryWritePrecondition {
  store: MemoryStoreName;
  key: IDBValidKey;
  expected: unknown | undefined;
  indexName?: string;
}

export interface MemoryCursorScanOptions<T> {
  query?: IDBValidKey | IDBKeyRange | null;
  direction?: IDBCursorDirection;
  limit?: number;
  accept?: (value: T) => boolean;
}

export interface MemoryCursorVisitOptions<T> extends Omit<MemoryCursorScanOptions<T>, 'limit'> {
  /** Return false to stop without materialising the remaining rows. */
  visit: (value: T) => boolean | void;
}

export interface MemoryTransactionAccessor {
  get<T>(storeName: MemoryStoreName, key: IDBValidKey): Promise<T | undefined>;
  getFromIndex<T>(storeName: MemoryStoreName, indexName: string, key: IDBValidKey): Promise<T | undefined>;
  getAll<T>(storeName: MemoryStoreName): Promise<T[]>;
  getAllFromIndex<T>(
    storeName: MemoryStoreName,
    indexName: string,
    query?: IDBValidKey | IDBKeyRange | null,
  ): Promise<T[]>;
  scan<T>(storeName: MemoryStoreName, options?: MemoryCursorScanOptions<T>): Promise<T[]>;
  scanFromIndex<T>(
    storeName: MemoryStoreName,
    indexName: string,
    options?: MemoryCursorScanOptions<T>,
  ): Promise<T[]>;
  visit<T>(storeName: MemoryStoreName, options: MemoryCursorVisitOptions<T>): Promise<void>;
  visitFromIndex<T>(
    storeName: MemoryStoreName,
    indexName: string,
    options: MemoryCursorVisitOptions<T>,
  ): Promise<void>;
  put<T>(storeName: MemoryStoreName, value: T): void;
  delete(storeName: MemoryStoreName, key: IDBValidKey): void;
  clear(storeName: MemoryStoreName): void;
}

const openConnections = new Map<string, IDBDatabase>();

function databaseName(owner: string): string {
  // IndexedDB database names are origin-local and may contain arbitrary Unicode.
  // Keeping the owner in the name gives every authenticated account a hard local
  // boundary and lets logout remove only the current account's cache.
  return `studycommander-memory-v1:${owner.normalize('NFKC')}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')), { once: true });
  });
}

function cursorResults<T>(
  source: IDBObjectStore | IDBIndex,
  options: MemoryCursorScanOptions<T> = {},
): Promise<T[]> {
  const limit = Math.max(0, Math.floor(options.limit ?? Number.MAX_SAFE_INTEGER));
  if (limit === 0) return Promise.resolve([]);
  return new Promise<T[]>((resolve, reject) => {
    const rows: T[] = [];
    const request = source.openCursor(options.query ?? undefined, options.direction ?? 'next');
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB cursor failed')), { once: true });
    request.addEventListener('success', () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(rows);
        return;
      }
      const value = cursor.value as T;
      if (!options.accept || options.accept(value)) rows.push(value);
      if (rows.length >= limit) {
        resolve(rows);
        return;
      }
      cursor.continue();
    });
  });
}


function visitCursor<T>(
  source: IDBObjectStore | IDBIndex,
  options: MemoryCursorVisitOptions<T>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = source.openCursor(options.query ?? undefined, options.direction ?? 'next');
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB cursor failed')), { once: true });
    request.addEventListener('success', () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      const value = cursor.value as T;
      if ((!options.accept || options.accept(value)) && options.visit(value) === false) {
        resolve();
        return;
      }
      cursor.continue();
    });
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB transaction aborted')), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB transaction failed')), { once: true });
  });
}

function stableStoredValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableStoredValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableStoredValue(entry)]),
  );
}

function sameStoredValue(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return JSON.stringify(stableStoredValue(left)) === JSON.stringify(stableStoredValue(right));
}

function ensureIndex(store: IDBObjectStore, name: string, keyPath: string | string[], options?: IDBIndexParameters): void {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options);
}

function createSchema(database: IDBDatabase): void {
  const items = database.createObjectStore(MEMORY_STORES.items, { keyPath: 'id' });
  ensureIndex(items, 'updatedAt', 'updatedAt');
  ensureIndex(items, 'label', 'label');
  ensureIndex(items, 'verificationStatus', 'verificationStatus');

  const senses = database.createObjectStore(MEMORY_STORES.senses, { keyPath: 'id' });
  ensureIndex(senses, 'itemId', 'itemId');
  ensureIndex(senses, 'siblingGroupId', 'siblingGroupId');
  ensureIndex(senses, 'updatedAt', 'updatedAt');

  const answers = database.createObjectStore(MEMORY_STORES.answers, { keyPath: 'id' });
  ensureIndex(answers, 'senseId', 'senseId');
  ensureIndex(answers, 'displayForm', 'displayForm');
  ensureIndex(answers, 'updatedAt', 'updatedAt');

  const examples = database.createObjectStore(MEMORY_STORES.examples, { keyPath: 'id' });
  ensureIndex(examples, 'senseId', 'senseId');
  ensureIndex(examples, 'answerId', 'answerId');
  ensureIndex(examples, 'updatedAt', 'updatedAt');

  const exercises = database.createObjectStore(MEMORY_STORES.exercises, { keyPath: 'id' });
  ensureIndex(exercises, 'senseId', 'senseId');
  ensureIndex(exercises, 'answerId', 'answerId');
  ensureIndex(exercises, 'siblingGroupId', 'siblingGroupId');
  ensureIndex(exercises, 'updatedAt', 'updatedAt');

  const sets = database.createObjectStore(MEMORY_STORES.sets, { keyPath: 'id' });
  ensureIndex(sets, 'updatedAt', 'updatedAt');
  ensureIndex(sets, 'name', 'name');

  const members = database.createObjectStore(MEMORY_STORES.setMembers, { keyPath: ['setId', 'itemId'] });
  ensureIndex(members, 'setId', 'setId');
  ensureIndex(members, 'itemId', 'itemId');
  ensureIndex(members, 'sortOrder', 'order');

  const stats = database.createObjectStore(MEMORY_STORES.stats, { keyPath: 'id' });
  ensureIndex(stats, 'target', ['targetType', 'targetId', 'mode'], { unique: true });
  ensureIndex(stats, 'targetId', 'targetId');
  ensureIndex(stats, 'mode', 'mode');
  ensureIndex(stats, 'weaknessScore', 'weaknessScore');
  ensureIndex(stats, 'updatedAt', 'updatedAt');

  const attempts = database.createObjectStore(MEMORY_STORES.attempts, { keyPath: 'attemptId' });
  ensureIndex(attempts, 'sessionId', 'sessionId');
  ensureIndex(attempts, 'targetId', 'targetId');
  ensureIndex(attempts, 'senseId', 'senseId');
  ensureIndex(attempts, 'answerId', 'answerId');
  ensureIndex(attempts, 'exerciseId', 'exerciseId');
  ensureIndex(attempts, 'createdAt', 'createdAt');
  ensureIndex(attempts, 'createdAtId', ['createdAt', 'attemptId'], { unique: true });
  ensureIndex(attempts, 'sessionCreatedAtId', ['sessionId', 'createdAt', 'attemptId'], { unique: true });
  ensureIndex(attempts, 'targetCreatedAtId', ['targetId', 'createdAt', 'attemptId'], { unique: true });
  ensureIndex(attempts, 'senseCreatedAtId', ['senseId', 'createdAt', 'attemptId'], { unique: true });
  ensureIndex(attempts, 'answerCreatedAtId', ['answerId', 'createdAt', 'attemptId'], { unique: true });
  ensureIndex(attempts, 'exerciseCreatedAtId', ['exerciseId', 'createdAt', 'attemptId'], { unique: true });
  ensureIndex(attempts, 'syncedAt', 'syncedAt');

  const sessions = database.createObjectStore(MEMORY_STORES.sessions, { keyPath: 'id' });
  ensureIndex(sessions, 'status', 'status');
  ensureIndex(sessions, 'updatedAt', 'updatedAt');
  ensureIndex(sessions, 'updatedAtId', ['updatedAt', 'id'], { unique: true });
  ensureIndex(sessions, 'statusUpdatedAtId', ['status', 'updatedAt', 'id'], { unique: true });

  const pending = database.createObjectStore(MEMORY_STORES.pendingMutations, { keyPath: 'mutationId' });
  ensureIndex(pending, 'entityKey', 'entityKey');
  ensureIndex(pending, 'createdAt', 'createdAt');
  ensureIndex(pending, 'localSequence', 'localSequence', { unique: true });

  const conflicts = database.createObjectStore(MEMORY_STORES.conflicts, { keyPath: 'id' });
  ensureIndex(conflicts, 'entityKey', 'entityKey');
  ensureIndex(conflicts, 'createdAt', 'createdAt');
  ensureIndex(conflicts, 'createdAtId', ['createdAt', 'id'], { unique: true });
  ensureIndex(conflicts, 'resolvedAt', 'resolvedAt');

  database.createObjectStore(MEMORY_STORES.meta, { keyPath: 'key' });
}

function upgradeSchema(database: IDBDatabase, transaction: IDBTransaction, oldVersion: number): void {
  if (oldVersion === 0) {
    createSchema(database);
    return;
  }
  if (oldVersion < 2) {
    const attempts = transaction.objectStore(MEMORY_STORES.attempts);
    ensureIndex(attempts, 'senseId', 'senseId');
    ensureIndex(attempts, 'answerId', 'answerId');
    ensureIndex(attempts, 'exerciseId', 'exerciseId');
    const pending = transaction.objectStore(MEMORY_STORES.pendingMutations);
    ensureIndex(pending, 'localSequence', 'localSequence', { unique: true });
  }
  if (oldVersion < 3) {
    const attempts = transaction.objectStore(MEMORY_STORES.attempts);
    ensureIndex(attempts, 'createdAtId', ['createdAt', 'attemptId'], { unique: true });
    ensureIndex(attempts, 'sessionCreatedAtId', ['sessionId', 'createdAt', 'attemptId'], { unique: true });
    ensureIndex(attempts, 'targetCreatedAtId', ['targetId', 'createdAt', 'attemptId'], { unique: true });
    ensureIndex(attempts, 'senseCreatedAtId', ['senseId', 'createdAt', 'attemptId'], { unique: true });
    ensureIndex(attempts, 'answerCreatedAtId', ['answerId', 'createdAt', 'attemptId'], { unique: true });
    ensureIndex(attempts, 'exerciseCreatedAtId', ['exerciseId', 'createdAt', 'attemptId'], { unique: true });
    const sessions = transaction.objectStore(MEMORY_STORES.sessions);
    ensureIndex(sessions, 'updatedAtId', ['updatedAt', 'id'], { unique: true });
    ensureIndex(sessions, 'statusUpdatedAtId', ['status', 'updatedAt', 'id'], { unique: true });
    const conflicts = transaction.objectStore(MEMORY_STORES.conflicts);
    ensureIndex(conflicts, 'createdAtId', ['createdAt', 'id'], { unique: true });
  }
}

export async function openMemoryDatabase(owner: string): Promise<IDBDatabase> {
  if (!owner.trim()) throw new Error('Memory database owner is required');
  if (typeof indexedDB === 'undefined') throw new Error('このブラウザではオフライン保存を利用できません');

  const name = databaseName(owner);
  const current = openConnections.get(name);
  if (current) return current;

  const request = indexedDB.open(name, MEMORY_DB_VERSION);
  request.addEventListener('upgradeneeded', (event) => {
    const transaction = request.transaction;
    if (!transaction) throw new Error('IndexedDB upgrade transaction is unavailable');
    upgradeSchema(request.result, transaction, (event as IDBVersionChangeEvent).oldVersion);
  });
  const database = await requestResult(request);
  database.addEventListener('versionchange', () => {
    database.close();
    openConnections.delete(name);
  });
  openConnections.set(name, database);
  return database;
}

export async function deleteMemoryDatabase(owner: string): Promise<void> {
  if (!owner.trim() || typeof indexedDB === 'undefined') return;
  const name = databaseName(owner);
  openConnections.get(name)?.close();
  openConnections.delete(name);
  await requestResult(indexedDB.deleteDatabase(name));
}

export class IndexedDbMemoryStore {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly owner: string) {}

  private database(): Promise<IDBDatabase> {
    this.databasePromise ??= openMemoryDatabase(this.owner);
    return this.databasePromise;
  }

  async get<T>(storeName: MemoryStoreName, key: IDBValidKey): Promise<T | undefined> {
    const database = await this.database();
    const transaction = database.transaction(storeName, 'readonly');
    const result = await requestResult(transaction.objectStore(storeName).get(key));
    await transactionComplete(transaction);
    return result as T | undefined;
  }

  async getAll<T>(storeName: MemoryStoreName, query?: IDBValidKey | IDBKeyRange | null, limit?: number): Promise<T[]> {
    const database = await this.database();
    const transaction = database.transaction(storeName, 'readonly');
    const request = typeof limit === 'number'
      ? transaction.objectStore(storeName).getAll(query ?? undefined, limit)
      : transaction.objectStore(storeName).getAll(query ?? undefined);
    const result = await requestResult(request);
    await transactionComplete(transaction);
    return result as T[];
  }

  async getAllFromIndex<T>(
    storeName: MemoryStoreName,
    indexName: string,
    query?: IDBValidKey | IDBKeyRange | null,
    limit?: number,
  ): Promise<T[]> {
    const database = await this.database();
    const transaction = database.transaction(storeName, 'readonly');
    const index = transaction.objectStore(storeName).index(indexName);
    const request = typeof limit === 'number' ? index.getAll(query ?? undefined, limit) : index.getAll(query ?? undefined);
    const result = await requestResult(request);
    await transactionComplete(transaction);
    return result as T[];
  }

  async scan<T>(
    storeName: MemoryStoreName,
    options: MemoryCursorScanOptions<T> = {},
  ): Promise<T[]> {
    const database = await this.database();
    const transaction = database.transaction(storeName, 'readonly');
    const result = await cursorResults<T>(transaction.objectStore(storeName), options);
    await transactionComplete(transaction);
    return result;
  }

  async scanFromIndex<T>(
    storeName: MemoryStoreName,
    indexName: string,
    options: MemoryCursorScanOptions<T> = {},
  ): Promise<T[]> {
    const database = await this.database();
    const transaction = database.transaction(storeName, 'readonly');
    const result = await cursorResults<T>(transaction.objectStore(storeName).index(indexName), options);
    await transactionComplete(transaction);
    return result;
  }


  async visit<T>(storeName: MemoryStoreName, options: MemoryCursorVisitOptions<T>): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(storeName, 'readonly');
    await visitCursor<T>(transaction.objectStore(storeName), options);
    await transactionComplete(transaction);
  }

  async visitFromIndex<T>(
    storeName: MemoryStoreName,
    indexName: string,
    options: MemoryCursorVisitOptions<T>,
  ): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(storeName, 'readonly');
    await visitCursor<T>(transaction.objectStore(storeName).index(indexName), options);
    await transactionComplete(transaction);
  }

  async count(storeName: MemoryStoreName, query?: IDBValidKey | IDBKeyRange | null): Promise<number> {
    const database = await this.database();
    const transaction = database.transaction(storeName, 'readonly');
    const result = await requestResult(transaction.objectStore(storeName).count(query ?? undefined));
    await transactionComplete(transaction);
    return result;
  }

  async put<T>(storeName: MemoryStoreName, value: T): Promise<void> {
    await this.write([{ store: storeName, type: 'put', value }]);
  }

  async delete(storeName: MemoryStoreName, key: IDBValidKey): Promise<void> {
    await this.write([{ store: storeName, type: 'delete', key }]);
  }

  /**
   * Runs reads and writes in one transaction. Callbacks must only await requests
   * made through the accessor; awaiting timers or network I/O would let IndexedDB
   * auto-commit the transaction.
   */
  async transaction<T>(
    storeNames: MemoryStoreName[],
    mode: IDBTransactionMode,
    callback: (accessor: MemoryTransactionAccessor) => Promise<T> | T,
  ): Promise<T> {
    if (storeNames.length === 0) throw new Error('At least one IndexedDB store is required');
    const database = await this.database();
    const transaction = database.transaction([...new Set(storeNames)], mode);
    const completion = transactionComplete(transaction);
    const accessor: MemoryTransactionAccessor = {
      get: async <Value>(storeName: MemoryStoreName, key: IDBValidKey) => {
        const result = await requestResult(transaction.objectStore(storeName).get(key));
        return result as Value | undefined;
      },
      getFromIndex: async <Value>(storeName: MemoryStoreName, indexName: string, key: IDBValidKey) => {
        const result = await requestResult(transaction.objectStore(storeName).index(indexName).get(key));
        return result as Value | undefined;
      },
      getAll: async <Value>(storeName: MemoryStoreName) => {
        const result = await requestResult(transaction.objectStore(storeName).getAll());
        return result as Value[];
      },
      getAllFromIndex: async <Value>(
        storeName: MemoryStoreName,
        indexName: string,
        query?: IDBValidKey | IDBKeyRange | null,
      ) => {
        const result = await requestResult(
          transaction.objectStore(storeName).index(indexName).getAll(query ?? undefined),
        );
        return result as Value[];
      },
      scan: async <Value>(storeName: MemoryStoreName, options: MemoryCursorScanOptions<Value> = {}) => (
        cursorResults<Value>(transaction.objectStore(storeName), options)
      ),
      scanFromIndex: async <Value>(
        storeName: MemoryStoreName,
        indexName: string,
        options: MemoryCursorScanOptions<Value> = {},
      ) => cursorResults<Value>(transaction.objectStore(storeName).index(indexName), options),
      visit: async <Value>(storeName: MemoryStoreName, options: MemoryCursorVisitOptions<Value>) => (
        visitCursor<Value>(transaction.objectStore(storeName), options)
      ),
      visitFromIndex: async <Value>(
        storeName: MemoryStoreName,
        indexName: string,
        options: MemoryCursorVisitOptions<Value>,
      ) => visitCursor<Value>(transaction.objectStore(storeName).index(indexName), options),
      put: <Value>(storeName: MemoryStoreName, value: Value) => {
        transaction.objectStore(storeName).put(value);
      },
      delete: (storeName: MemoryStoreName, key: IDBValidKey) => {
        transaction.objectStore(storeName).delete(key);
      },
      clear: (storeName: MemoryStoreName) => {
        transaction.objectStore(storeName).clear();
      },
    };
    try {
      const result = await callback(accessor);
      await completion;
      return result;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already have aborted because a request failed.
      }
      try {
        await completion;
      } catch {
        // Preserve the original callback/request error.
      }
      throw error;
    }
  }

  /** Executes every operation in one IndexedDB transaction. */
  async write(operations: MemoryWriteOperation[]): Promise<void> {
    if (operations.length === 0) return;
    const database = await this.database();
    const stores = [...new Set(operations.map((operation) => operation.store))];
    const transaction = database.transaction(stores, 'readwrite');
    const completion = transactionComplete(transaction);
    try {
      for (const operation of operations) {
        const store = transaction.objectStore(operation.store);
        if (operation.type === 'put') {
          if (operation.value === undefined) throw new Error(`Missing value for ${operation.store}`);
          store.put(operation.value);
        } else {
          if (operation.key === undefined) throw new Error(`Missing key for ${operation.store}`);
          store.delete(operation.key);
        }
      }
    } catch (error) {
      transaction.abort();
      throw error;
    }
    await completion;
  }

  /** Adds local-only, monotonically increasing ordering to queued mutations. */
  async writeWithPendingMutations(
    operations: MemoryWriteOperation[],
    pendingMutations: object[],
    preconditions: MemoryWritePrecondition[] = [],
  ): Promise<void> {
    if (operations.length === 0 && pendingMutations.length === 0 && preconditions.length === 0) return;
    if (operations.some((operation) => operation.store === MEMORY_STORES.pendingMutations)) {
      throw new Error('Pending mutations must be passed separately for sequence assignment');
    }
    const stores = [
      ...operations.map((operation) => operation.store),
      ...preconditions.map((precondition) => precondition.store),
      MEMORY_STORES.pendingMutations,
      MEMORY_STORES.meta,
    ];
    await this.transaction(stores, 'readwrite', async (transaction) => {
      for (const precondition of preconditions) {
        const current = precondition.indexName
          ? await transaction.getFromIndex(precondition.store, precondition.indexName, precondition.key)
          : await transaction.get(precondition.store, precondition.key);
        if (!sameStoredValue(current, precondition.expected)) {
          throw new Error('取込プレビューの確認後に端末内データが変更されました。もう一度プレビューを確認してください');
        }
      }
      const counter = await transaction.get<{ key: string; value: number }>(MEMORY_STORES.meta, 'nextMutationSequence');
      let sequence = Number.isSafeInteger(counter?.value) && (counter?.value ?? 0) > 0 ? counter!.value : 1;
      for (const operation of operations) {
        if (operation.type === 'put') {
          if (operation.value === undefined) throw new Error(`Missing value for ${operation.store}`);
          transaction.put(operation.store, operation.value);
        } else {
          if (operation.key === undefined) throw new Error(`Missing key for ${operation.store}`);
          transaction.delete(operation.store, operation.key);
        }
      }
      for (const mutation of pendingMutations) {
        transaction.put(MEMORY_STORES.pendingMutations, { ...mutation, localSequence: sequence });
        sequence += 1;
      }
      transaction.put(MEMORY_STORES.meta, { key: 'nextMutationSequence', value: sequence });
    });
  }

  async clearStores(storeNames: MemoryStoreName[]): Promise<void> {
    if (storeNames.length === 0) return;
    const database = await this.database();
    const transaction = database.transaction(storeNames, 'readwrite');
    const completion = transactionComplete(transaction);
    for (const storeName of storeNames) transaction.objectStore(storeName).clear();
    await completion;
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    const row = await this.get<{ key: string; value: T }>(MEMORY_STORES.meta, key);
    return row?.value;
  }

  async setMeta<T>(key: string, value: T): Promise<void> {
    await this.put(MEMORY_STORES.meta, { key, value });
  }

  close(): void {
    void this.database().then((database) => database.close());
    this.databasePromise = null;
    openConnections.delete(databaseName(this.owner));
  }
}

function migrationKey(storeName: MemoryStoreName, value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  const row = value as Record<string, unknown>;
  switch (storeName) {
    case MEMORY_STORES.setMembers: return JSON.stringify([row.setId, row.itemId]);
    case MEMORY_STORES.attempts: return String(row.attemptId);
    case MEMORY_STORES.pendingMutations: return String(row.mutationId);
    case MEMORY_STORES.meta: return String(row.key);
    default: return String(row.id);
  }
}

function chooseMigrationValue(storeName: MemoryStoreName, source: unknown, target: unknown): unknown {
  if (!source || typeof source !== 'object' || !target || typeof target !== 'object') return target;
  const sourceRow = source as Record<string, unknown>;
  const targetRow = target as Record<string, unknown>;
  if (storeName === MEMORY_STORES.meta) {
    if (sourceRow.key === 'syncCursor' || sourceRow.key === 'nextMutationSequence') {
      const sourceNumber = Number(sourceRow.value);
      const targetNumber = Number(targetRow.value);
      return Number.isFinite(sourceNumber) && sourceNumber > targetNumber ? source : target;
    }
    return target;
  }
  if (storeName === MEMORY_STORES.attempts) {
    const sourceUndone = typeof sourceRow.undoneAt === 'string' ? sourceRow.undoneAt : undefined;
    const targetUndone = typeof targetRow.undoneAt === 'string' ? targetRow.undoneAt : undefined;
    const sourceSynced = typeof sourceRow.syncedAt === 'string' ? sourceRow.syncedAt : undefined;
    const targetSynced = typeof targetRow.syncedAt === 'string' ? targetRow.syncedAt : undefined;
    const latestUndone = [sourceUndone, targetUndone].filter((value): value is string => Boolean(value)).sort().pop();
    const latestSynced = [sourceSynced, targetSynced].filter((value): value is string => Boolean(value)).sort().pop();
    return {
      ...sourceRow,
      ...targetRow,
      ...(latestUndone ? { undoneAt: latestUndone } : {}),
      ...(latestSynced ? { syncedAt: latestSynced } : {}),
    };
  }
  const sourceRevision = typeof sourceRow.revision === 'number' ? sourceRow.revision : undefined;
  const targetRevision = typeof targetRow.revision === 'number' ? targetRow.revision : undefined;
  if (sourceRevision !== undefined && targetRevision !== undefined && sourceRevision !== targetRevision) {
    return sourceRevision > targetRevision ? source : target;
  }
  const sourceUpdated = typeof sourceRow.updatedAt === 'string' ? sourceRow.updatedAt : undefined;
  const targetUpdated = typeof targetRow.updatedAt === 'string' ? targetRow.updatedAt : undefined;
  if (sourceUpdated && targetUpdated && sourceUpdated !== targetUpdated) return sourceUpdated > targetUpdated ? source : target;
  if (typeof sourceRow.deletedAt === 'string' && typeof targetRow.deletedAt !== 'string') return source;
  return target;
}

function compareMigratedPending(left: unknown, right: unknown): number {
  const leftRow = left && typeof left === 'object' ? left as Record<string, unknown> : {};
  const rightRow = right && typeof right === 'object' ? right as Record<string, unknown> : {};
  if (leftRow.entityKey === rightRow.entityKey) {
    const leftRevision = typeof leftRow.baseRevision === 'number' ? leftRow.baseRevision : -1;
    const rightRevision = typeof rightRow.baseRevision === 'number' ? rightRow.baseRevision : -1;
    if (leftRevision !== rightRevision) return leftRevision - rightRevision;
  }
  const byCreatedAt = String(leftRow.createdAt ?? '').localeCompare(String(rightRow.createdAt ?? ''));
  if (byCreatedAt !== 0) return byCreatedAt;
  const leftSequence = typeof leftRow.localSequence === 'number' ? leftRow.localSequence : Number.MAX_SAFE_INTEGER;
  const rightSequence = typeof rightRow.localSequence === 'number' ? rightRow.localSequence : Number.MAX_SAFE_INTEGER;
  if (leftSequence !== rightSequence) return leftSequence - rightSequence;
  return String(leftRow.mutationId ?? '').localeCompare(String(rightRow.mutationId ?? ''));
}

/**
 * Migrates the legacy username-scoped database to the authenticated server user
 * id. The target copy is one transaction; the source is deleted only after that
 * transaction commits, so interruption can duplicate but never lose data.
 */
export async function migrateMemoryDatabaseOwner(oldOwner: string, newOwner: string): Promise<void> {
  if (!oldOwner.trim() || !newOwner.trim() || databaseName(oldOwner) === databaseName(newOwner)) return;
  if (typeof indexedDB === 'undefined') return;
  const storeNames = Object.values(MEMORY_STORES);
  const sourceDatabase = await openMemoryDatabase(oldOwner);
  const sourceTransaction = sourceDatabase.transaction(storeNames, 'readonly');
  const sourceCompletion = transactionComplete(sourceTransaction);
  const sourceEntries = await Promise.all(storeNames.map(async (storeName) => ({
    storeName,
    values: await requestResult(sourceTransaction.objectStore(storeName).getAll()) as unknown[],
  })));
  await sourceCompletion;
  if (sourceEntries.every((entry) => entry.values.length === 0)) {
    await deleteMemoryDatabase(oldOwner);
    return;
  }

  const target = new IndexedDbMemoryStore(newOwner);
  await target.transaction(storeNames, 'readwrite', async (transaction) => {
    for (const { storeName, values } of sourceEntries) {
      if (storeName === MEMORY_STORES.pendingMutations) continue;
      const existing = await transaction.getAll<unknown>(storeName);
      const byKey = new Map(existing.map((value) => [migrationKey(storeName, value), value]));
      for (const value of values) {
        const key = migrationKey(storeName, value);
        const current = byKey.get(key);
        const selected = current === undefined ? value : chooseMigrationValue(storeName, value, current);
        transaction.put(storeName, selected);
        byKey.set(key, selected);
      }
    }

    // localSequence has a unique index, but both databases can legitimately use
    // the same sequence values. Merge by mutationId, then assign a fresh single
    // sequence inside this target transaction so no pending work is dropped.
    const targetPending = await transaction.getAll<unknown>(MEMORY_STORES.pendingMutations);
    const sourcePending = sourceEntries.find((entry) => entry.storeName === MEMORY_STORES.pendingMutations)?.values ?? [];
    const pendingById = new Map(targetPending.map((value) => [migrationKey(MEMORY_STORES.pendingMutations, value), value]));
    for (const value of sourcePending) {
      const key = migrationKey(MEMORY_STORES.pendingMutations, value);
      const current = pendingById.get(key);
      pendingById.set(
        key,
        current === undefined ? value : chooseMigrationValue(MEMORY_STORES.pendingMutations, value, current),
      );
    }
    const mergedPending = [...pendingById.values()].sort(compareMigratedPending);
    transaction.clear(MEMORY_STORES.pendingMutations);
    mergedPending.forEach((value, index) => {
      transaction.put(MEMORY_STORES.pendingMutations, {
        ...(value as Record<string, unknown>),
        localSequence: index + 1,
      });
    });
    transaction.put(MEMORY_STORES.meta, { key: 'nextMutationSequence', value: mergedPending.length + 1 });
  });
  await deleteMemoryDatabase(oldOwner);
}
