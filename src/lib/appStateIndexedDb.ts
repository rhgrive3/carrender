import type {
  AppSettings,
  AppState,
  AvailabilitySlot,
  DayPlanOverride,
  FixedEvent,
  Material,
  PlanHistoryEntry,
  StudySession,
  StudyTask,
  Subject,
  UserGoal,
} from '../types';
import type { MainSyncMetadata } from './mainSync';
import { isAppStateShape, migrateState } from './storage';

const MAIN_STATE_DB_VERSION = 1;

export const MAIN_STATE_STORES = {
  meta: 'mainStateMeta',
  goal: 'mainGoals',
  settings: 'mainSettings',
  subjects: 'mainSubjects',
  materials: 'mainMaterials',
  tasks: 'mainTasks',
  sessions: 'mainSessions',
  planHistory: 'mainPlanHistory',
  availability: 'mainAvailability',
  dayPlans: 'mainDayPlans',
  fixedEvents: 'mainFixedEvents',
} as const;

export type MainStateStoreName = (typeof MAIN_STATE_STORES)[keyof typeof MAIN_STATE_STORES];

interface StateMetaRecord {
  key: 'state';
  version: number;
  schemaVersion: number;
  isDemo: boolean;
  onboarded: boolean;
  lastReschedule: AppState['lastReschedule'];
  lastPlannedDate: AppState['lastPlannedDate'];
  lastScheduleResult: AppState['lastScheduleResult'];
  lastPlanReason: AppState['lastPlanReason'];
  savedAt: string;
}

interface SettingsRecord {
  key: 'settings';
  value: AppSettings;
}

interface SyncMetaRecord {
  key: 'sync';
  value: MainSyncMetadata;
}

export interface AppStateWriteStats {
  puts: number;
  deletes: number;
  clearedStores: number;
}

const openConnections = new Map<string, IDBDatabase>();

export function mainStateDatabaseName(owner: string): string {
  return `studycommander-main-v1:${owner.normalize('NFKC')}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')), { once: true });
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
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return JSON.stringify(stableStoredValue(left)) === JSON.stringify(stableStoredValue(right));
}

function createSchema(database: IDBDatabase): void {
  database.createObjectStore(MAIN_STATE_STORES.meta, { keyPath: 'key' });
  database.createObjectStore(MAIN_STATE_STORES.goal, { keyPath: 'id' });
  database.createObjectStore(MAIN_STATE_STORES.settings, { keyPath: 'key' });
  database.createObjectStore(MAIN_STATE_STORES.subjects, { keyPath: 'id' });

  const materials = database.createObjectStore(MAIN_STATE_STORES.materials, { keyPath: 'id' });
  materials.createIndex('subjectId', 'subjectId');
  materials.createIndex('targetDate', 'targetDate');
  materials.createIndex('archived', 'archived');

  const tasks = database.createObjectStore(MAIN_STATE_STORES.tasks, { keyPath: 'id' });
  tasks.createIndex('scheduledDate', 'scheduledDate');
  tasks.createIndex('status', 'status');
  tasks.createIndex('materialId', 'materialId');

  const sessions = database.createObjectStore(MAIN_STATE_STORES.sessions, { keyPath: 'id' });
  sessions.createIndex('date', 'date');
  sessions.createIndex('startedAt', 'startedAt');
  sessions.createIndex('materialId', 'materialId');

  const history = database.createObjectStore(MAIN_STATE_STORES.planHistory, { keyPath: 'id' });
  history.createIndex('scheduledDate', 'scheduledDate');
  history.createIndex('materialId', 'materialId');

  database.createObjectStore(MAIN_STATE_STORES.availability, { keyPath: 'weekday' });
  database.createObjectStore(MAIN_STATE_STORES.dayPlans, { keyPath: 'date' });

  const fixedEvents = database.createObjectStore(MAIN_STATE_STORES.fixedEvents, { keyPath: 'id' });
  fixedEvents.createIndex('date', 'date');
  fixedEvents.createIndex('weekday', 'weekday');
}

export async function openMainStateDatabase(owner: string): Promise<IDBDatabase> {
  if (!owner.trim()) throw new Error('Main state database owner is required');
  if (typeof indexedDB === 'undefined') throw new Error('このブラウザではIndexedDB保存を利用できません');

  const name = mainStateDatabaseName(owner);
  const existing = openConnections.get(name);
  if (existing) return existing;

  const request = indexedDB.open(name, MAIN_STATE_DB_VERSION);
  request.addEventListener('upgradeneeded', (event) => {
    if ((event as IDBVersionChangeEvent).oldVersion === 0) createSchema(request.result);
  });
  const database = await requestResult(request);
  database.addEventListener('versionchange', () => {
    database.close();
    openConnections.delete(name);
  });
  openConnections.set(name, database);
  return database;
}

export async function deleteMainStateDatabase(owner: string): Promise<void> {
  if (!owner.trim() || typeof indexedDB === 'undefined') return;
  const name = mainStateDatabaseName(owner);
  openConnections.get(name)?.close();
  openConnections.delete(name);
  await requestResult(indexedDB.deleteDatabase(name));
}

function stateMeta(state: AppState): StateMetaRecord {
  return {
    key: 'state',
    version: state.version,
    schemaVersion: state.schemaVersion,
    isDemo: state.isDemo,
    onboarded: state.onboarded,
    lastReschedule: state.lastReschedule,
    lastPlannedDate: state.lastPlannedDate,
    lastScheduleResult: state.lastScheduleResult ?? null,
    lastPlanReason: state.lastPlanReason ?? null,
    savedAt: new Date().toISOString(),
  };
}

interface CollectionDescriptor<T> {
  store: MainStateStoreName;
  values: T[];
  previousValues: T[];
  key: (value: T) => IDBValidKey;
}

function collectionDescriptors(state: AppState, previous: AppState | null): CollectionDescriptor<unknown>[] {
  return [
    { store: MAIN_STATE_STORES.subjects, values: state.subjects, previousValues: previous?.subjects ?? [], key: (value) => (value as Subject).id },
    { store: MAIN_STATE_STORES.materials, values: state.materials, previousValues: previous?.materials ?? [], key: (value) => (value as Material).id },
    { store: MAIN_STATE_STORES.tasks, values: state.tasks, previousValues: previous?.tasks ?? [], key: (value) => (value as StudyTask).id },
    { store: MAIN_STATE_STORES.sessions, values: state.sessions, previousValues: previous?.sessions ?? [], key: (value) => (value as StudySession).id },
    { store: MAIN_STATE_STORES.planHistory, values: state.planHistory ?? [], previousValues: previous?.planHistory ?? [], key: (value) => (value as PlanHistoryEntry).id },
    { store: MAIN_STATE_STORES.availability, values: state.availability, previousValues: previous?.availability ?? [], key: (value) => (value as AvailabilitySlot).weekday },
    { store: MAIN_STATE_STORES.dayPlans, values: state.dayPlans, previousValues: previous?.dayPlans ?? [], key: (value) => (value as DayPlanOverride).date },
    { store: MAIN_STATE_STORES.fixedEvents, values: state.fixedEvents, previousValues: previous?.fixedEvents ?? [], key: (value) => (value as FixedEvent).id },
  ];
}

export class AppStateIndexedDbRepository {
  private databasePromise: Promise<IDBDatabase> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(readonly owner: string) {
    if (!owner.trim()) throw new Error('Main state repository owner is required');
  }

  private database(): Promise<IDBDatabase> {
    this.databasePromise ??= openMainStateDatabase(this.owner);
    return this.databasePromise;
  }

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.writeChain.catch(() => undefined).then(operation);
    this.writeChain = run.then(() => undefined, () => undefined);
    return run;
  }

  async loadState(): Promise<AppState | null> {
    await this.writeChain.catch(() => undefined);
    const database = await this.database();
    const storeNames = Object.values(MAIN_STATE_STORES);
    const transaction = database.transaction(storeNames, 'readonly');
    const completion = transactionComplete(transaction);
    const getAll = <T>(storeName: MainStateStoreName) => requestResult(transaction.objectStore(storeName).getAll()) as Promise<T[]>;
    const get = <T>(storeName: MainStateStoreName, key: IDBValidKey) => requestResult(transaction.objectStore(storeName).get(key)) as Promise<T | undefined>;

    const [meta, settingsRecord, goals, subjects, materials, tasks, sessions, planHistory, availability, dayPlans, fixedEvents] = await Promise.all([
      get<StateMetaRecord>(MAIN_STATE_STORES.meta, 'state'),
      get<SettingsRecord>(MAIN_STATE_STORES.settings, 'settings'),
      getAll<UserGoal>(MAIN_STATE_STORES.goal),
      getAll<Subject>(MAIN_STATE_STORES.subjects),
      getAll<Material>(MAIN_STATE_STORES.materials),
      getAll<StudyTask>(MAIN_STATE_STORES.tasks),
      getAll<StudySession>(MAIN_STATE_STORES.sessions),
      getAll<PlanHistoryEntry>(MAIN_STATE_STORES.planHistory),
      getAll<AvailabilitySlot>(MAIN_STATE_STORES.availability),
      getAll<DayPlanOverride>(MAIN_STATE_STORES.dayPlans),
      getAll<FixedEvent>(MAIN_STATE_STORES.fixedEvents),
    ]);
    await completion;
    if (!meta || !settingsRecord) return null;

    const candidate: AppState = {
      version: meta.version,
      schemaVersion: meta.schemaVersion,
      isDemo: meta.isDemo,
      onboarded: meta.onboarded,
      goal: goals[0] ?? null,
      subjects,
      materials,
      tasks,
      planHistory,
      sessions,
      availability: availability.sort((left, right) => left.weekday - right.weekday),
      dayPlans: dayPlans.sort((left, right) => left.date.localeCompare(right.date)),
      fixedEvents,
      settings: settingsRecord.value,
      lastReschedule: meta.lastReschedule,
      lastPlannedDate: meta.lastPlannedDate,
      lastScheduleResult: meta.lastScheduleResult ?? null,
      lastPlanReason: meta.lastPlanReason ?? null,
    };
    if (!isAppStateShape(candidate)) throw new Error('IndexedDBの予定データ形式が正しくありません');
    const migration = migrateState(candidate);
    if (!migration.ok) {
      throw new Error(`IndexedDBの予定データを移行できません: ${migration.errors.map((issue) => `${issue.targetId}.${issue.field}`).join(', ')}`);
    }
    return migration.state;
  }

  async loadSyncMetadata(): Promise<MainSyncMetadata | null> {
    await this.writeChain.catch(() => undefined);
    const database = await this.database();
    const transaction = database.transaction(MAIN_STATE_STORES.meta, 'readonly');
    const result = await requestResult(transaction.objectStore(MAIN_STATE_STORES.meta).get('sync')) as SyncMetaRecord | undefined;
    await transactionComplete(transaction);
    return result?.value?.owner ? result.value : null;
  }

  saveSyncMetadata(metadata: MainSyncMetadata): Promise<void> {
    return this.enqueueWrite(async () => {
      const database = await this.database();
      const transaction = database.transaction(MAIN_STATE_STORES.meta, 'readwrite');
      transaction.objectStore(MAIN_STATE_STORES.meta).put({ key: 'sync', value: metadata } satisfies SyncMetaRecord);
      await transactionComplete(transaction);
    });
  }

  replaceState(state: AppState): Promise<AppStateWriteStats> {
    return this.enqueueWrite(() => this.writeState(state, null, true));
  }

  saveState(state: AppState, previous: AppState | null): Promise<AppStateWriteStats> {
    return this.enqueueWrite(() => this.writeState(state, previous, false));
  }

  async migrateLegacyState(state: AppState): Promise<void> {
    const normalized = migrateState(state);
    if (!normalized.ok) throw new Error('移行元の予定データが不正です');
    await this.replaceState(normalized.state);
    const restored = await this.loadState();
    if (!restored || !sameStoredValue(restored, normalized.state)) {
      throw new Error('IndexedDBへの移行後検証に失敗しました');
    }
  }

  private async writeState(state: AppState, previous: AppState | null, replace: boolean): Promise<AppStateWriteStats> {
    const database = await this.database();
    const storeNames = Object.values(MAIN_STATE_STORES);
    const transaction = database.transaction(storeNames, 'readwrite');
    const completion = transactionComplete(transaction);
    const stats: AppStateWriteStats = { puts: 0, deletes: 0, clearedStores: 0 };

    try {
      if (replace) {
        for (const storeName of storeNames) {
          if (storeName === MAIN_STATE_STORES.meta) continue;
          transaction.objectStore(storeName).clear();
          stats.clearedStores += 1;
        }
      }

      transaction.objectStore(MAIN_STATE_STORES.meta).put(stateMeta(state));
      stats.puts += 1;

      if (replace || !previous || !sameStoredValue(state.settings, previous.settings)) {
        transaction.objectStore(MAIN_STATE_STORES.settings).put({ key: 'settings', value: state.settings } satisfies SettingsRecord);
        stats.puts += 1;
      }

      const goalStore = transaction.objectStore(MAIN_STATE_STORES.goal);
      if (!replace && previous?.goal && previous.goal.id !== state.goal?.id) {
        goalStore.delete(previous.goal.id);
        stats.deletes += 1;
      }
      if (state.goal && (replace || !previous?.goal || !sameStoredValue(state.goal, previous.goal))) {
        goalStore.put(state.goal);
        stats.puts += 1;
      }

      for (const descriptor of collectionDescriptors(state, replace ? null : previous)) {
        const store = transaction.objectStore(descriptor.store);
        if (replace) {
          for (const value of descriptor.values) {
            store.put(value);
            stats.puts += 1;
          }
          continue;
        }
        const previousByKey = new Map(descriptor.previousValues.map((value) => [descriptor.key(value), value]));
        const nextKeys = new Set<IDBValidKey>();
        for (const value of descriptor.values) {
          const key = descriptor.key(value);
          nextKeys.add(key);
          const before = previousByKey.get(key);
          if (before === undefined || !sameStoredValue(value, before)) {
            store.put(value);
            stats.puts += 1;
          }
        }
        for (const before of descriptor.previousValues) {
          const key = descriptor.key(before);
          if (!nextKeys.has(key)) {
            store.delete(key);
            stats.deletes += 1;
          }
        }
      }
    } catch (error) {
      transaction.abort();
      await completion.catch(() => undefined);
      throw error;
    }

    await completion;
    return stats;
  }
}
