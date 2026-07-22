import assert from 'node:assert/strict';
import type { AppState } from '../src/types';
import {
  getEmergencyStateCacheStatus,
  persistEmergencyStateCache,
  resetEmergencyStateCacheStatus,
  subscribeEmergencyStateCacheStatus,
} from '../src/lib/emergencyStateCache';
import { EMERGENCY_CACHE_MAX_CHARS } from '../src/lib/storage';

const STATE_KEY = 'studycommander_state_v1';
const UPDATED_KEY = 'studycommander_state_updated_at_v1';

class ControlledStorage {
  readonly values = new Map<string, string>();
  failure: Error | DOMException | null = null;
  setItem(key: string, value: string): void {
    if (this.failure) throw this.failure;
    this.values.set(key, value);
  }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
}

const storage = new ControlledStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
resetEmergencyStateCacheStatus();

const phases: string[] = [];
const unsubscribe = subscribeEmergencyStateCacheStatus((status) => phases.push(status.phase));

const small = { payload: 'small' } as unknown as AppState;
const first = persistEmergencyStateCache(small);
assert.equal(first.phase, 'active');
assert.equal(storage.getItem(STATE_KEY), JSON.stringify(small));
assert.ok(storage.getItem(UPDATED_KEY));

const oversized = { payload: 'x'.repeat(EMERGENCY_CACHE_MAX_CHARS + 1) } as unknown as AppState;
const suppressed = persistEmergencyStateCache(oversized);
assert.deepEqual([suppressed.phase, suppressed.reason], ['suppressed', 'oversized']);
assert.equal(storage.getItem(STATE_KEY), null, '古い緊急snapshotを残さない');
assert.match(suppressed.message ?? '', /通常の端末保存と同期は継続/);

const recovered = persistEmergencyStateCache(small);
assert.equal(recovered.phase, 'active', 'state縮小後は再読み込みなしで復帰する');
assert.equal(storage.getItem(STATE_KEY), JSON.stringify(small));
assert.ok(phases.includes('retrying'), '復旧試行状態を通知する');

storage.failure = new DOMException('quota reached', 'QuotaExceededError');
const quota = persistEmergencyStateCache(small);
assert.deepEqual([quota.phase, quota.reason], ['suppressed', 'quota']);
storage.failure = null;
assert.equal(persistEmergencyStateCache(small).phase, 'active', 'quota解消後も自動復帰する');

storage.failure = new Error('blocked');
const unavailable = persistEmergencyStateCache(small);
assert.deepEqual([unavailable.phase, unavailable.reason], ['suppressed', 'unavailable']);
assert.match(getEmergencyStateCacheStatus().message ?? '', /緊急保存用キャッシュ/);

unsubscribe();
console.log('✅ emergency cache recovery regressions passed');
