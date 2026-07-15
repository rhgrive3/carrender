import assert from 'node:assert/strict';
import type { AppState } from '../src/types';
import { shouldUseEmergencyStateCache } from '../src/state/MainStatePersistence';
import {
  EMERGENCY_CACHE_MAX_CHARS,
  clearOwnedState,
  saveStateNow,
  subscribeStateSaveFailure,
} from '../src/lib/storage';

const STATE_KEY = 'studycommander_state_v1';
const UPDATED_KEY = 'studycommander_state_updated_at_v1';

class ControlledStorage {
  readonly values = new Map<string, string>();
  setCalls = 0;
  failure: Error | DOMException | null = null;

  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void {
    this.setCalls += 1;
    if (this.failure) throw this.failure;
    this.values.set(key, value);
  }
}

assert.equal(shouldUseEmergencyStateCache(null, '2026-07-16T08:00:00.000Z', true), false, 'undated legacy cache never overwrites IndexedDB');
assert.equal(shouldUseEmergencyStateCache('not-a-date', '2026-07-16T08:00:00.000Z', true), false, 'invalid cache timestamp never overwrites IndexedDB');
assert.equal(shouldUseEmergencyStateCache('2026-07-16T07:00:00.000Z', '2026-07-16T08:00:00.000Z', true), false, 'older emergency cache never overwrites IndexedDB');
assert.equal(shouldUseEmergencyStateCache('2026-07-16T09:00:00.000Z', '2026-07-16T08:00:00.000Z', true), true, 'newer pagehide cache may recover the latest edit');
assert.equal(shouldUseEmergencyStateCache(null, null, false), true, 'legacy cache remains usable when IndexedDB has no state');

const storage = new ControlledStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

let latestFailure: string | null = null;
const unsubscribe = subscribeStateSaveFailure((failure) => { latestFailure = failure?.message ?? null; });

storage.values.set(STATE_KEY, 'stale-emergency-copy');
storage.values.set(UPDATED_KEY, '2026-07-16T00:00:00.000Z');
const oversized = { payload: 'x'.repeat(EMERGENCY_CACHE_MAX_CHARS + 1) } as unknown as AppState;
saveStateNow(oversized);
assert.equal(storage.getItem(STATE_KEY), null, 'oversized state removes the stale emergency snapshot');
assert.equal(storage.getItem(UPDATED_KEY), null, 'oversized state removes the stale emergency timestamp');
assert.equal(latestFailure, null, 'oversized optional cache is not surfaced as a user-facing save failure');
const callsAfterOversized = storage.setCalls;
saveStateNow({ payload: 'small' } as unknown as AppState);
assert.equal(storage.setCalls, callsAfterOversized, 'suppressed emergency cache does not retry on every state change');

clearOwnedState();
storage.values.set(STATE_KEY, 'older-copy');
storage.failure = new DOMException('quota reached', 'QuotaExceededError');
saveStateNow({ payload: 'small' } as unknown as AppState);
assert.equal(storage.getItem(STATE_KEY), null, 'quota failure removes the older snapshot instead of leaving rollback data');
assert.equal(latestFailure, null, 'quota failure degrades to IndexedDB without duplicate warning UI');

clearOwnedState();
storage.failure = new Error('storage blocked');
saveStateNow({ payload: 'small' } as unknown as AppState);
assert.match(latestFailure ?? '', /端末への保存に失敗/, 'non-quota storage failures remain visible');

unsubscribe();
console.log('✅ emergency cache overflow regressions passed');
