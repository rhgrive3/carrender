import assert from 'node:assert/strict';
import { ValidatedMemoryRepository } from '../src/features/memory/infrastructure/validatedRepository';

type TestStore = {
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta<T>(key: string, value: T): Promise<void>;
};

async function transientFailureCanRetry(): Promise<void> {
  const repository = new ValidatedMemoryRepository('client-id-retry');
  const store = repository.store as unknown as TestStore;
  let reads = 0;
  let writes = 0;

  store.getMeta = async <T>() => {
    reads += 1;
    if (reads === 1) throw new Error('temporary IndexedDB failure');
    return undefined as T | undefined;
  };
  store.setMeta = async () => {
    writes += 1;
  };

  await assert.rejects(repository.clientId(), /temporary IndexedDB failure/);
  const [firstRetry, secondRetry] = await Promise.all([
    repository.clientId(),
    repository.clientId(),
  ]);

  assert.equal(firstRetry, secondRetry, 'concurrent retry callers must share one generated ID');
  assert.equal(reads, 2, 'the failed initialization should be retried exactly once');
  assert.equal(writes, 1, 'concurrent retries must persist only one client ID');
}

async function successfulInitializationStaysCached(): Promise<void> {
  const repository = new ValidatedMemoryRepository('client-id-cache');
  const store = repository.store as unknown as TestStore;
  let reads = 0;

  store.getMeta = async <T>() => {
    reads += 1;
    return 'client_existing' as T;
  };
  store.setMeta = async () => {
    throw new Error('existing client ID must not be rewritten');
  };

  assert.equal(await repository.clientId(), 'client_existing');
  assert.equal(await repository.clientId(), 'client_existing');
  assert.equal(reads, 1, 'a successful initialization must remain cached');
}

await transientFailureCanRetry();
await successfulInitializationStaysCached();
console.log('memory client ID retry tests passed');
