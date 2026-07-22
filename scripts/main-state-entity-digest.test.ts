import assert from 'node:assert/strict';
import { emptyState } from '../src/state/AppContext';
import {
  MAIN_STATE_ENTITY_HASH_VERSION,
  mainStateEntityHash,
} from '../src/lib/mainStateMerge';
import {
  canonicalMainStateEntityJSON,
  sha256Hex,
} from '../src/lib/mainStateEntityDigest';
import {
  getMainSyncMetadata,
  markMainSyncClean,
  markMainSyncDirty,
} from '../src/lib/mainSync';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const memoryStorage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', {
  value: memoryStorage,
  configurable: true,
});

const owner = 'digest-user';
const baseUpdatedAt = '2026-07-22T00:00:00.000Z';
const changedAt = '2026-07-22T00:01:00.000Z';
const scopedMetadataKey = `studycommander_main_sync_meta_v2:${encodeURIComponent(owner)}`;

assert.equal(
  sha256Hex('abc'),
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  'SHA-256の既知ベクトルと一致する',
);
assert.equal(
  mainStateEntityHash({ b: 2, nested: { z: true, omitted: undefined }, a: 1 }),
  mainStateEntityHash({ a: 1, nested: { omitted: undefined, z: true }, b: 2 }),
  'objectの生成順やundefined fieldに依存しない',
);
assert.equal(
  canonicalMainStateEntityJSON({ b: 2, a: 1 }),
  '{"a":1,"b":2}',
  'canonical JSONはobject keyを再帰的に固定する',
);
assert.match(mainStateEntityHash({ a: 1 }), /^[0-9a-f]{64}$/, 'entity digestは64桁のlowercase hexになる');
assert.notEqual(mainStateEntityHash({ a: 1 }), mainStateEntityHash({ a: 2 }), '主要fieldの変更を検出する');
assert.notEqual(mainStateEntityHash([1, 2]), mainStateEntityHash([2, 1]), '意味のある配列順は保持する');

memoryStorage.clear();
const cleanState = { ...emptyState(), onboarded: true };
markMainSyncClean(owner, baseUpdatedAt, changedAt, cleanState);
const strongMetadata = getMainSyncMetadata(owner);
assert.equal(strongMetadata?.baseEntityHashVersion, MAIN_STATE_ENTITY_HASH_VERSION, '新規metadataへdigest versionを保存する');
const strongHashes = Object.values(strongMetadata?.baseEntityHashes ?? {})
  .flatMap((section) => Object.values(section));
assert.ok(strongHashes.length > 0, 'clean stateからentity merge baseを作る');
assert.ok(strongHashes.every((hash) => /^[0-9a-f]{64}$/.test(hash)), '新規merge baseはすべてSHA-256 digestになる');
markMainSyncDirty(owner, baseUpdatedAt, '2026-07-22T00:02:00.000Z');
assert.equal(getMainSyncMetadata(owner)?.baseEntityHashVersion, MAIN_STATE_ENTITY_HASH_VERSION, 'dirty化しても元のdigest versionを保持する');
assert.deepEqual(getMainSyncMetadata(owner)?.baseEntityHashes, strongMetadata?.baseEntityHashes, 'dirty中にmerge baseを書き換えない');

memoryStorage.clear();
localStorage.setItem('studycommander_main_sync_meta_v1', JSON.stringify({
  owner,
  dirty: true,
  baseUpdatedAt,
  localChangedAt: changedAt,
  baseEntityHashes: { sessions: { session1: '1234abcd' } },
}));
const migratedLegacy = getMainSyncMetadata(owner);
assert.equal(migratedLegacy?.dirty, true, '旧metadataのdirty/base世代は維持する');
assert.equal(migratedLegacy?.baseUpdatedAt, baseUpdatedAt);
assert.equal(migratedLegacy?.baseEntityHashes, undefined, '旧32bit hashは自動merge基準から除外する');
assert.equal(migratedLegacy?.baseEntityHashVersion, undefined);
assert.equal(localStorage.getItem('studycommander_main_sync_meta_v1'), null, '旧singleton metadataをowner scoped keyへ移行する');
const persistedMigration = JSON.parse(localStorage.getItem(scopedMetadataKey) ?? 'null') as Record<string, unknown> | null;
assert.ok(persistedMigration && !('baseEntityHashes' in persistedMigration), '移行先にも衝突し得る旧hashを残さない');

markMainSyncClean(owner, baseUpdatedAt, '2026-07-22T00:03:00.000Z', cleanState);
const rebaselined = getMainSyncMetadata(owner);
assert.equal(rebaselined?.baseEntityHashVersion, MAIN_STATE_ENTITY_HASH_VERSION, '次のclean保存で強いdigestへ再基準化する');
assert.ok(Object.values(rebaselined?.baseEntityHashes ?? {})
  .flatMap((section) => Object.values(section))
  .every((hash) => /^[0-9a-f]{64}$/.test(hash)));

memoryStorage.clear();
localStorage.setItem(scopedMetadataKey, JSON.stringify({
  owner,
  dirty: true,
  baseUpdatedAt,
  localChangedAt: changedAt,
  baseEntityHashVersion: MAIN_STATE_ENTITY_HASH_VERSION,
  baseEntityHashes: { sessions: { session1: '1234abcd' } },
}));
assert.equal(getMainSyncMetadata(owner), null, 'versionと長さが矛盾するmetadataを拒否する');

memoryStorage.clear();
localStorage.setItem(scopedMetadataKey, JSON.stringify({
  owner,
  dirty: true,
  baseUpdatedAt,
  localChangedAt: changedAt,
  baseEntityHashVersion: 'sha512-v1',
  baseEntityHashes: { sessions: { session1: 'a'.repeat(128) } },
}));
assert.equal(getMainSyncMetadata(owner), null, '未対応versionを推測で使用しない');

console.log('✅ main state entity digest regressions passed');
