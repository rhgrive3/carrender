import assert from 'node:assert/strict';
import type { AppState } from '../src/types';
import {
  getEmergencyStateCacheStatus,
  persistEmergencyStateCache,
  resetEmergencyStateCacheStatus,
  subscribeEmergencyStateCacheStatus,
} from '../src/lib/emergencyStateCache';
import {
  EMERGENCY_CACHE_MAX_CHARS,
  saveStateNow,
  subscribeStateSaveFailure,
} from '../src/lib/storage';

const STATE_KEY = 'studycommander_state_v1';
const UPDATED_KEY = 'studycommander_state_updated_at_v1';

class ControlledStorage {
  readonly values = new Map<string, string>();
  failure: Error | DOMException | null = null;
  failSetKey: string | null = null;
  failRemove = false;
  setItem(key: string, value: string): void {
    if (this.failure || this.failSetKey === key) throw this.failure ?? new Error(`blocked: ${key}`);
    this.values.set(key, value);
  }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  removeItem(key: string): void {
    if (this.failRemove) throw new Error(`remove blocked: ${key}`);
    this.values.delete(key);
  }
}

const storage = new ControlledStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
resetEmergencyStateCacheStatus();

const phases: string[] = [];
const unsubscribe = subscribeEmergencyStateCacheStatus((status) => phases.push(status.phase));
let latestLegacyFailure: string | null = null;
const unsubscribeLegacyFailure = subscribeStateSaveFailure((failure) => {
  latestLegacyFailure = failure?.message ?? null;
});

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
storage.failure = null;

const generationOne = { payload: 'generation-one' } as unknown as AppState;
saveStateNow(generationOne);
assert.equal(storage.getItem(STATE_KEY), JSON.stringify(generationOne));
assert.ok(storage.getItem(UPDATED_KEY));
assert.equal(latestLegacyFailure, null);

storage.failSetKey = UPDATED_KEY;
const generationTwo = { payload: 'generation-two' } as unknown as AppState;
saveStateNow(generationTwo);
assert.equal(storage.getItem(STATE_KEY), null, 'timestamp保存失敗時は新stateだけを残さない');
assert.equal(storage.getItem(UPDATED_KEY), null, 'timestamp保存失敗時は古い世代情報も残さない');
assert.match(latestLegacyFailure ?? '', /端末への保存に失敗/, '元の保存失敗通知を維持する');

storage.values.set(STATE_KEY, JSON.stringify(generationOne));
storage.values.set(UPDATED_KEY, '2026-07-22T00:00:00.000Z');
storage.failRemove = true;
saveStateNow(generationTwo);
assert.equal(storage.getItem(STATE_KEY), JSON.stringify(generationTwo), 'cleanup拒否時も最初のstate書込み結果は観測できる');
assert.equal(storage.getItem(UPDATED_KEY), '2026-07-22T00:00:00.000Z', 'cleanup拒否時は古いtimestampが残り得る');
assert.match(latestLegacyFailure ?? '', /端末への保存に失敗/, 'cleanup拒否でも元の保存失敗を隠さない');

storage.failRemove = false;
storage.values.clear();
storage.failSetKey = null;
saveStateNow(generationTwo);
assert.equal(storage.getItem(STATE_KEY), JSON.stringify(generationTwo), '後続の正常保存でstateを再作成する');
assert.ok(storage.getItem(UPDATED_KEY), '後続の正常保存でtimestampも再作成する');
assert.equal(latestLegacyFailure, null, '正常保存後は互換writerの失敗状態を解消する');

unsubscribeLegacyFailure();
unsubscribe();
console.log('✅ emergency cache recovery regressions passed');
