/** Durable reconciliation tests for the main AppState sync metadata. */
/// <reference types="node" />
import { emptyState } from '../src/state/AppContext';
import {
  clearMainSyncMetadata,
  decideInitialSync,
  getMainSyncConflictBackup,
  getMainSyncMetadata,
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
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
});

const owner = 'user-1';
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
check('同期成功後はdirtyを解除し最新クラウド世代を保存', !clean.dirty && clean.baseUpdatedAt === v2, clean);
check('cleanな端末は次回起動時にクラウド版を採用', decideInitialSync({
  metadata: getMainSyncMetadata(owner),
  remoteUpdatedAt: v2,
  hasRemoteState: true,
  hasLocalState: true,
}) === 'useRemote');

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
const backup = getMainSyncConflictBackup(owner);
check('競合解決前に端末版とクラウド版を同時退避', saved
  && backup?.localState.onboarded === true
  && backup.remoteState?.onboarded === false
  && backup.remoteUpdatedAt === v2, backup);
check('別ユーザーは競合バックアップを読めない', getMainSyncConflictBackup('other-user') === null);
clearMainSyncMetadata();
check('ログアウト時は同期メタデータと競合退避を消去', getMainSyncMetadata(owner) === null && getMainSyncConflictBackup(owner) === null);

console.log(failures === 0 ? '\n🎉 ALL PASS (main sync)' : `\n💥 ${failures} FAILURES (main sync)`);
process.exit(failures === 0 ? 0 : 1);
