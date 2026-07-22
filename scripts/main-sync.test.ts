/** Durable reconciliation tests for the main AppState sync metadata. */
/// <reference types="node" />
import { emptyState } from '../src/state/AppContext';
import {
  clearMainSyncMetadata,
  decideInitialSync,
  getCurrentMainSyncMetadata,
  getMainSyncConflictBackup,
  getMainSyncMetadata,
  MainSyncMetadataPersistenceError,
  markMainSyncClean,
  markMainSyncDirty,
  saveMainSyncConflictBackup,
} from '../src/lib/mainSync';

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.error(`  ❌ ${name}`, detail ?? '');
  }
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  failWrites = false;
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.values.set(key, value);
  }
}

const memoryStorage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', {
  value: memoryStorage,
  configurable: true,
});

const owner = 'user-1';
const otherOwner = 'user-2';
const v1 = '2026-07-14T00:00:00.000Z';
const v2 = '2026-07-14T00:01:00.000Z';

console.log('--- Main sync: startup reconciliation ---');
clearMainSyncMetadata();
check('旧クライアント由来で両方にデータがある場合は自動上書きしない', decideInitialSync({
  metadata: null,
  remoteUpdatedAt: v1,
  hasRemoteState: true,
  hasLocalState: true,
}) === 'conflict');
check('端末データがない初回ログインではクラウド版を採用', decideInitialSync({
  metadata: null,
  remoteUpdatedAt: v1,
  hasRemoteState: true,
  hasLocalState: false,
}) === 'useRemote');
check('クラウドが空で端末データがあれば端末版を初回送信', decideInitialSync({
  metadata: null,
  remoteUpdatedAt: null,
  hasRemoteState: false,
  hasLocalState: true,
}) === 'pushLocal');
check('端末にもクラウドにもデータがなければ何もしない', decideInitialSync({
  metadata: null,
  remoteUpdatedAt: null,
  hasRemoteState: false,
  hasLocalState: false,
}) === 'none');

console.log('--- Main sync: durable dirty base ---');
const firstDirty = markMainSyncDirty(owner, v1, '2026-07-14T00:00:10.000Z');
const secondDirty = markMainSyncDirty(owner, v2, '2026-07-14T00:00:20.000Z');
check('dirty metadataの保存成功を呼出側へ返す', firstDirty.persisted && secondDirty.persisted, { firstDirty, secondDirty });
check('複数回編集しても最初に編集したクラウド世代を保持', firstDirty.baseUpdatedAt === v1 && secondDirty.baseUpdatedAt === v1, secondDirty);
check('同じクラウド世代上の未同期編集は再起動後に送信対象', decideInitialSync({
  metadata: getMainSyncMetadata(owner),
  remoteUpdatedAt: v1,
  hasRemoteState: true,
  hasLocalState: true,
}) === 'pushLocal');
check('クラウド世代が進んでいれば端末版を上書きせず競合', decideInitialSync({
  metadata: getMainSyncMetadata(owner),
  remoteUpdatedAt: v2,
  hasRemoteState: true,
  hasLocalState: true,
}) === 'conflict');

const clean = markMainSyncClean(owner, v2, '2026-07-14T00:02:00.000Z');
check('clean metadataの保存成功を呼出側へ返す', clean.persisted, clean);
check('同期成功後はdirtyを解除し最新クラウド世代を保存', !clean.dirty && clean.baseUpdatedAt === v2, clean);
check('cleanな端末は次回起動時にクラウド版を採用', decideInitialSync({
  metadata: getMainSyncMetadata(owner),
  remoteUpdatedAt: v2,
  hasRemoteState: true,
  hasLocalState: true,
}) === 'useRemote');

console.log('--- Main sync: owner-scoped metadata ---');
markMainSyncDirty(otherOwner, v1, '2026-07-14T00:02:05.000Z');
check('別アカウントのdirty化で元アカウントのclean世代を上書きしない',
  getMainSyncMetadata(owner)?.dirty === false
    && getMainSyncMetadata(owner)?.baseUpdatedAt === v2
    && getMainSyncMetadata(otherOwner)?.dirty === true,
  { owner: getMainSyncMetadata(owner), other: getMainSyncMetadata(otherOwner) });
clearMainSyncMetadata(owner);
check('アカウント単位の消去で対象ownerだけ削除する',
  getMainSyncMetadata(owner) === null && getMainSyncMetadata(otherOwner)?.dirty === true);
markMainSyncClean(owner, v2, '2026-07-14T00:02:06.000Z');

console.log('--- Main sync: legacy singleton migration ---');
clearMainSyncMetadata();
localStorage.setItem('studycommander_main_sync_meta_v1', JSON.stringify({
  owner,
  dirty: true,
  baseUpdatedAt: v1,
  localChangedAt: v2,
}));
check('旧共通キーは所有者一致時だけ読み込める',
  getMainSyncMetadata(otherOwner) === null && getMainSyncMetadata(owner)?.baseUpdatedAt === v1);
check('旧共通キーをowner scopedキーへ移行後に削除する',
  localStorage.getItem('studycommander_main_sync_meta_v1') === null
    && getMainSyncMetadata(owner)?.dirty === true);
markMainSyncClean(owner, v2, '2026-07-14T00:02:07.000Z');
markMainSyncDirty(otherOwner, v1, '2026-07-14T00:02:08.000Z');

console.log('--- Main sync: metadata persistence failures ---');
memoryStorage.failWrites = true;
const failedDirty = markMainSyncDirty(owner, v2, '2026-07-14T00:02:10.000Z');
check('dirty metadata書込み失敗をfalseで返す', failedDirty.persisted === false, failedDirty);
check('dirty書込み失敗時に保存済みmetadataを上書きしない', getMainSyncMetadata(owner)?.dirty === false);
let cleanFailure: unknown = null;
try {
  markMainSyncClean(owner, v2, '2026-07-14T00:02:20.000Z');
} catch (caught) {
  cleanFailure = caught;
}
check('clean metadata書込み失敗は同期成功扱いを止める例外になる', cleanFailure instanceof MainSyncMetadataPersistenceError, cleanFailure);
const nonThrowingClean = markMainSyncClean(owner, v2, '2026-07-14T00:02:30.000Z', undefined, false);
check('bootstrap復元では失敗を結果として扱える', nonThrowingClean.persisted === false, nonThrowingClean);
memoryStorage.failWrites = false;
const recoveredDirty = markMainSyncDirty(owner, v2, '2026-07-14T00:02:40.000Z');
check('保存環境の回復後は再試行でmetadataを永続化できる', recoveredDirty.persisted && getMainSyncMetadata(owner)?.dirty === true, recoveredDirty);
markMainSyncClean(owner, v2, '2026-07-14T00:02:50.000Z');

console.log('--- Main sync: malformed legacy metadata ---');
localStorage.setItem('studycommander_main_sync_meta_v1', JSON.stringify({
  owner,
  dirty: true,
  baseUpdatedAt: 'not-a-date',
  localChangedAt: v1,
}));
check('不正なbaseUpdatedAtを同期判断へ流さない', getCurrentMainSyncMetadata() === null);
localStorage.setItem('studycommander_main_sync_meta_v1', JSON.stringify({
  owner,
  dirty: true,
  baseUpdatedAt: v1,
  localChangedAt: '2026-07-14',
}));
check('非正規のlocalChangedAtを同期判断へ流さない', getCurrentMainSyncMetadata() === null);
localStorage.setItem('studycommander_main_sync_meta_v1', JSON.stringify({
  owner,
  dirty: true,
  baseUpdatedAt: v1,
  localChangedAt: v2,
  baseEntityHashes: { sessions: { session1: 'invalid-hash' } },
}));
check('壊れたentity hashをマージ基準へ使わない', getCurrentMainSyncMetadata() === null);
localStorage.removeItem('studycommander_main_sync_meta_v1');

console.log('--- Main sync: conflict recovery backup ---');
const localState = { ...emptyState(), onboarded: true };
const remoteState = { ...emptyState(), onboarded: false };
const saved = saveMainSyncConflictBackup({
  owner,
  createdAt: '2026-07-14T00:03:00.000Z',
  localBaseUpdatedAt: v1,
  remoteUpdatedAt: v2,
  localState,
  remoteState,
});
const otherSaved = saveMainSyncConflictBackup({
  owner: otherOwner,
  createdAt: '2026-07-14T00:03:10.000Z',
  localBaseUpdatedAt: v2,
  remoteUpdatedAt: v2,
  localState: remoteState,
  remoteState: localState,
});
const backup = getMainSyncConflictBackup(owner);
check('競合解決前に端末版とクラウド版を同時退避', saved
  && backup?.localState.onboarded === true
  && backup.remoteState?.onboarded === false
  && backup.remoteUpdatedAt === v2, backup);
check('別ユーザーの競合バックアップを独立して保持', otherSaved
  && getMainSyncConflictBackup(otherOwner)?.localState.onboarded === false
  && getMainSyncConflictBackup(owner)?.localState.onboarded === true);
clearMainSyncMetadata(owner);
check('ログアウト時は対象ownerの同期情報だけを消去',
  getMainSyncMetadata(owner) === null
    && getMainSyncConflictBackup(owner) === null
    && getMainSyncMetadata(otherOwner)?.dirty === true
    && getMainSyncConflictBackup(otherOwner) !== null);
clearMainSyncMetadata();
check('明示的な全消去では全ownerの同期情報を消去',
  getMainSyncMetadata(otherOwner) === null && getMainSyncConflictBackup(otherOwner) === null);

console.log(failures === 0 ? '\n🎉 ALL PASS (main sync)' : `\n💥 ${failures} FAILURES (main sync)`);
process.exit(failures === 0 ? 0 : 1);
