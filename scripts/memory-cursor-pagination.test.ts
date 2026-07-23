import assert from 'node:assert/strict';
import { MemoryRepository, type LocalMemoryAttempt, type MemoryConflict } from '../src/features/memory/infrastructure/repositories';
import { MEMORY_STORES } from '../src/features/memory/infrastructure/indexedDb';
import type { MemorySession } from '../src/features/memory/domain/types';

type ScanCall = {
  storeName: string;
  options: {
    indexName?: string;
    query?: IDBValidKey | IDBKeyRange | null;
    direction?: IDBCursorDirection;
    limit?: number;
    predicate?: (value: unknown) => boolean;
  };
};

Object.defineProperty(globalThis, 'IDBKeyRange', {
  configurable: true,
  value: {
    bound: (lower: IDBValidKey, upper: IDBValidKey) => ({ lower, upper }),
  },
});

const repository = new MemoryRepository('cursor-test-owner');
const scanCalls: ScanCall[] = [];
const attempts: LocalMemoryAttempt[] = [
  {
    attemptId: 'old', sessionId: 'session-1', clientId: 'client', itemId: 'item', senseId: 'sense', targetId: 'target',
    mode: 'output', exerciseType: 'flashcard', assessment: 'correct', errorTypes: [], hintUsed: false, responseMs: 100,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    attemptId: 'voided', sessionId: 'session-1', clientId: 'client', itemId: 'item', senseId: 'sense', targetId: 'target',
    mode: 'output', exerciseType: 'flashcard', assessment: 'incorrect', errorTypes: [], hintUsed: false, responseMs: 200,
    createdAt: '2026-01-02T00:00:00.000Z', undoneAt: '2026-01-03T00:00:00.000Z',
  },
  {
    attemptId: 'new', sessionId: 'session-1', clientId: 'client', itemId: 'item', senseId: 'sense', targetId: 'target',
    mode: 'output', exerciseType: 'flashcard', assessment: 'correct', errorTypes: [], hintUsed: false, responseMs: 300,
    createdAt: '2026-01-03T00:00:00.000Z',
  },
];
const sessions: MemorySession[] = [
  { id: 'session-old', setIds: [], mode: 'output', status: 'completed', targetIds: [], order: [], currentIndex: 0, startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1 },
  { id: 'session-new', setIds: [], mode: 'output', status: 'completed', targetIds: [], order: [], currentIndex: 0, startedAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', revision: 1 },
];
const conflicts: MemoryConflict[] = [
  { id: 'resolved', entityType: 'item', entityId: 'item-1', entityKey: 'item:item-1', localValue: {}, serverValue: {}, createdAt: '2026-01-03T00:00:00.000Z', resolvedAt: '2026-01-04T00:00:00.000Z', resolution: 'server' },
  { id: 'open', entityType: 'item', entityId: 'item-2', entityKey: 'item:item-2', localValue: {}, serverValue: {}, createdAt: '2026-01-02T00:00:00.000Z' },
];

(repository.store as unknown as {
  scan<T>(storeName: string, options: ScanCall['options']): Promise<T[]>;
}).scan = async <T>(storeName: string, options: ScanCall['options']) => {
  scanCalls.push({ storeName, options });
  const source = storeName === MEMORY_STORES.sessions ? sessions : storeName === MEMORY_STORES.conflicts ? conflicts : attempts;
  const direction = options.direction ?? 'next';
  const ordered = direction === 'prev' ? [...source].reverse() : [...source];
  const filtered = options.predicate ? ordered.filter((value) => options.predicate!(value)) : ordered;
  return filtered.slice(0, options.limit ?? filtered.length) as T[];
};

const latestSessions = await repository.listSessions(1);
assert.deepEqual(latestSessions.map((session) => session.id), ['session-new']);
assert.equal(scanCalls.at(-1)?.options.indexName, 'updatedAt');
assert.equal(scanCalls.at(-1)?.options.direction, 'prev');
assert.equal(scanCalls.at(-1)?.options.limit, 1);

const targetAttempts = await repository.getTargetAttempts('target', 1);
assert.deepEqual(targetAttempts.map((attempt) => attempt.attemptId), ['new']);
assert.equal(scanCalls.at(-1)?.options.indexName, 'targetCreatedAt');
assert.equal(scanCalls.at(-1)?.options.direction, 'prev');
assert.equal(scanCalls.at(-1)?.options.limit, 1);

const sessionAttempts = await repository.getSessionAttempts('session-1');
assert.deepEqual(sessionAttempts.map((attempt) => attempt.attemptId), ['old', 'new']);
assert.equal(scanCalls.at(-1)?.options.indexName, 'sessionCreatedAt');
assert.equal(scanCalls.at(-1)?.options.direction, 'next');

const openConflicts = await repository.listConflicts(10);
assert.deepEqual(openConflicts.map((conflict) => conflict.id), ['open']);
assert.equal(scanCalls.at(-1)?.storeName, MEMORY_STORES.conflicts);
assert.equal(scanCalls.at(-1)?.options.indexName, 'createdAt');
assert.equal(scanCalls.at(-1)?.options.direction, 'prev');

const indexedDbSource = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/features/memory/infrastructure/indexedDb.ts', import.meta.url), 'utf8'));
assert.match(indexedDbSource, /openCursor\(/, 'cursor APIを使う');
assert.match(indexedDbSource, /collected\.length >= limit/, '要求件数でcursor走査を停止する');
assert.match(indexedDbSource, /sessionCreatedAt[\s\S]*targetCreatedAt[\s\S]*senseCreatedAt[\s\S]*answerCreatedAt[\s\S]*exerciseCreatedAt/, '履歴の複合indexを作成する');

console.log('memory cursor pagination tests passed');
