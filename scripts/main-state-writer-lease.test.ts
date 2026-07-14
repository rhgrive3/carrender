import assert from 'node:assert/strict';
import {
  ensureMainStateWriterLease,
  hasMainStateWriterLease,
  MAIN_STATE_WRITER_LEASE_MS,
  parseMainStateWriterLease,
  releaseMainStateWriterLease,
} from '../src/lib/mainStateWriterLease';

class FakeStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

{
  const store = new FakeStorage();
  assert.equal(ensureMainStateWriterLease('user', 1_000, store, 'tab-a'), true);
  assert.equal(hasMainStateWriterLease('user', 1_001, store, 'tab-a'), true);
  assert.equal(ensureMainStateWriterLease('user', 1_002, store, 'tab-b'), false, '有効中の担当を別タブが奪わない');
  assert.equal(hasMainStateWriterLease('user', 1_002, store, 'tab-b'), false);

  assert.equal(ensureMainStateWriterLease('user', 1_000 + MAIN_STATE_WRITER_LEASE_MS + 1, store, 'tab-b'), true, '期限切れ後は別タブが引き継ぐ');
  assert.equal(hasMainStateWriterLease('user', 1_000 + MAIN_STATE_WRITER_LEASE_MS + 2, store, 'tab-b'), true);
  assert.equal(hasMainStateWriterLease('user', 1_000 + MAIN_STATE_WRITER_LEASE_MS + 2, store, 'tab-a'), false);

  releaseMainStateWriterLease('user', store, 'tab-a');
  assert.equal(hasMainStateWriterLease('user', 1_000 + MAIN_STATE_WRITER_LEASE_MS + 2, store, 'tab-b'), true, '非担当のreleaseは無視する');
  releaseMainStateWriterLease('user', store, 'tab-b');
  assert.equal(hasMainStateWriterLease('user', 1_000 + MAIN_STATE_WRITER_LEASE_MS + 2, store, 'tab-b'), false);
}

assert.equal(parseMainStateWriterLease('{bad json'), null);
assert.equal(parseMainStateWriterLease(JSON.stringify({ owner: 'user' })), null);
assert.deepEqual(
  parseMainStateWriterLease(JSON.stringify({ owner: 'user', holderId: 'tab', acquiredAt: 1, expiresAt: 2 })),
  { owner: 'user', holderId: 'tab', acquiredAt: 1, expiresAt: 2 },
);

console.log('✅ main state writer lease regressions passed');
