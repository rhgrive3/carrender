/** Regression tests for differential IndexedDB persistence baselines. */
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import type { AppState } from '../src/types';
import { persistMainStateSnapshot, type StoredStateBaseline } from '../src/state/MainStatePersistence';

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.error(`  ❌ ${name}`, detail ?? '');
  }
}

function snapshot(marker: string): AppState {
  return { version: 1, marker } as unknown as AppState;
}

const initial = snapshot('initial');
const failedSnapshot = snapshot('failed-write');
const recoveredSnapshot = snapshot('recovered-write');
const baseline: StoredStateBaseline = { current: initial };
const previousValues: Array<AppState | null> = [];
let attempts = 0;

const repository = {
  async saveState(_state: AppState, previous: AppState | null): Promise<never | void> {
    previousValues.push(previous);
    attempts += 1;
    if (attempts === 1) throw new Error('simulated quota failure');
  },
};

console.log('--- Main state persistence: failed write baseline ---');
let rejected = false;
try {
  await persistMainStateSnapshot(repository, failedSnapshot, baseline);
} catch {
  rejected = true;
}
check('書込み失敗を呼び出し元へ返す', rejected);
check('失敗したsnapshotを差分基準へ昇格させない', baseline.current === initial, baseline.current);

await persistMainStateSnapshot(repository, recoveredSnapshot, baseline);
check('再試行は最後に成功したsnapshotとの差分として保存する', previousValues[1] === initial, previousValues);
check('成功後だけ差分基準を進める', baseline.current === recoveredSnapshot, baseline.current);

console.log('\n--- Main state persistence: concurrent write ordering ---');
const firstSnapshot = snapshot('first');
const secondSnapshot = snapshot('second');
const concurrentBaseline: StoredStateBaseline = { current: initial };
const starts: string[] = [];
const concurrentPrevious: Array<AppState | null> = [];
let releaseFirst: (() => void) | null = null;
const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
const concurrentRepository = {
  async saveState(state: AppState, previous: AppState | null): Promise<void> {
    const marker = (state as unknown as { marker: string }).marker;
    starts.push(marker);
    concurrentPrevious.push(previous);
    if (marker === 'first') await firstGate;
  },
};

const firstWrite = persistMainStateSnapshot(concurrentRepository, firstSnapshot, concurrentBaseline);
const secondWrite = persistMainStateSnapshot(concurrentRepository, secondSnapshot, concurrentBaseline);
await Promise.resolve();
await Promise.resolve();
check('先行保存の完了前に後続保存を開始しない', starts.length === 1 && starts[0] === 'first', starts);
releaseFirst?.();
await Promise.all([firstWrite, secondWrite]);
check('保存を呼出順に実行する', starts.join(',') === 'first,second', starts);
check('後続保存は直前に成功したsnapshotとの差分を使う', concurrentPrevious[1] === firstSnapshot, concurrentPrevious);
check('最終baselineを最新snapshotへ進める', concurrentBaseline.current === secondSnapshot, concurrentBaseline.current);

console.log('\n--- Main state persistence: burst coalescing ---');
const burstBaseline: StoredStateBaseline = { current: initial };
const burstStarts: string[] = [];
const burstPrevious: Array<AppState | null> = [];
let releaseBurst: (() => void) | null = null;
const burstGate = new Promise<void>((resolve) => { releaseBurst = resolve; });
const burstRepository = {
  async saveState(state: AppState, previous: AppState | null): Promise<void> {
    const marker = (state as unknown as { marker: string }).marker;
    burstStarts.push(marker);
    burstPrevious.push(previous);
    if (marker === 'burst-0') await burstGate;
  },
};
const burstSnapshots = Array.from({ length: 100 }, (_, index) => snapshot(`burst-${index}`));
const burstWrites = burstSnapshots.map((value) => persistMainStateSnapshot(burstRepository, value, burstBaseline));
await Promise.resolve();
await Promise.resolve();
check('100連続更新でも実行中の1件だけを開始する', burstStarts.length === 1 && burstStarts[0] === 'burst-0', burstStarts);
releaseBurst?.();
await Promise.all(burstWrites);
check('未開始99件を最新snapshot一件へまとめる', burstStarts.join(',') === 'burst-0,burst-99', burstStarts);
check('coalesce後の保存は最後にcommitしたsnapshotを差分基準にする', burstPrevious[1] === burstSnapshots[0], burstPrevious);
check('全呼出しは最新snapshot commit後に完了する', burstBaseline.current === burstSnapshots[99], burstBaseline.current);

console.log('\n--- Main state persistence: queued retry after failure ---');
const queuedFailureBaseline: StoredStateBaseline = { current: initial };
const queuedPrevious: Array<AppState | null> = [];
let queuedAttempts = 0;
const queuedFailureRepository = {
  async saveState(_state: AppState, previous: AppState | null): Promise<void> {
    queuedPrevious.push(previous);
    queuedAttempts += 1;
    if (queuedAttempts === 1) throw new Error('first queued write fails');
  },
};
const rejectedWrite = persistMainStateSnapshot(queuedFailureRepository, failedSnapshot, queuedFailureBaseline);
const succeedingWrite = persistMainStateSnapshot(queuedFailureRepository, recoveredSnapshot, queuedFailureBaseline);
await rejectedWrite.catch(() => undefined);
await succeedingWrite;
check('先行失敗後も後続保存を実行する', queuedAttempts === 2, queuedAttempts);
check('先行失敗後の差分基準は成功済み状態のまま', queuedPrevious[1] === initial, queuedPrevious);
check('後続成功後に最新snapshotへ進める', queuedFailureBaseline.current === recoveredSnapshot, queuedFailureBaseline.current);

console.log('\n--- Main state persistence: pagehide joins latest pending snapshot ---');
const pagehideBaseline: StoredStateBaseline = { current: initial };
const pagehideStarts: string[] = [];
let releasePagehide: (() => void) | null = null;
const pagehideGate = new Promise<void>((resolve) => { releasePagehide = resolve; });
const pagehideRepository = {
  async saveState(state: AppState): Promise<void> {
    const marker = (state as unknown as { marker: string }).marker;
    pagehideStarts.push(marker);
    if (marker === 'normal') await pagehideGate;
  },
};
const normalWrite = persistMainStateSnapshot(pagehideRepository, snapshot('normal'), pagehideBaseline);
const stalePending = persistMainStateSnapshot(pagehideRepository, snapshot('stale-pending'), pagehideBaseline);
const pagehideLatest = snapshot('pagehide-latest');
const pagehideWrite = persistMainStateSnapshot(pagehideRepository, pagehideLatest, pagehideBaseline);
releasePagehide?.();
await Promise.all([normalWrite, stalePending, pagehideWrite]);
check('pagehide snapshotが未開始の古いsnapshotを置換する', pagehideStarts.join(',') === 'normal,pagehide-latest', pagehideStarts);
check('pagehide後の最終commitが最新stateと一致する', pagehideBaseline.current === pagehideLatest, pagehideBaseline.current);

console.log('\n--- Main state persistence: owner isolation ---');
const ownerASnapshot = snapshot('owner-a');
const ownerBSnapshot = snapshot('owner-b');
const ownerABaseline: StoredStateBaseline = { current: null };
const ownerBBaseline: StoredStateBaseline = { current: null };
let releaseOwnerA: (() => void) | null = null;
const ownerAGate = new Promise<void>((resolve) => { releaseOwnerA = resolve; });
const ownerBPrevious: Array<AppState | null> = [];
const ownerAWrite = persistMainStateSnapshot({
  async saveState(): Promise<void> { await ownerAGate; },
}, ownerASnapshot, ownerABaseline);
const ownerBWrite = persistMainStateSnapshot({
  async saveState(_state: AppState, previous: AppState | null): Promise<void> { ownerBPrevious.push(previous); },
}, ownerBSnapshot, ownerBBaseline);
await ownerBWrite;
check('別ownerの保存は旧ownerの未完了キューを待たない', ownerBPrevious.length === 1, ownerBPrevious);
check('別ownerの差分基準へ旧owner状態を混入しない', ownerBPrevious[0] === null && ownerBBaseline.current === ownerBSnapshot, ownerBPrevious);
releaseOwnerA?.();
await ownerAWrite;

const persistenceSource = readFileSync('src/state/MainStatePersistence.tsx', 'utf8');
check(
  'owner変更ごとに新しいbaselineオブジェクトを割り当てる',
  /const ownerBaseline: StoredStateBaseline = \{ current: null \};[\s\S]*persistenceBaselineRef\.current = ownerBaseline;/.test(persistenceSource),
);
check(
  'pagehide時の同期メタデータ保存失敗を処理する',
  /if \(metadata\) \{[\s\S]*void repository\.saveSyncMetadata\(metadata\)\.catch\(\(caught\) => \{[\s\S]*pagehide時の同期世代保存に失敗しました/.test(persistenceSource),
);
check(
  'pagehide時の同期メタデータ保存を投げっぱなしに戻さない',
  !/if \(metadata\) void repository\.saveSyncMetadata\(metadata\);/.test(persistenceSource),
);
check(
  'pagehideも通常保存と同じcoalescing境界を使う',
  /pagehide[\s\S]*persistMainStateSnapshot\(repository, stateRef\.current, baseline\)/.test(persistenceSource),
);

console.log(failures === 0 ? '\n🎉 ALL PASS (main state persistence)' : `\n💥 ${failures} FAILURES (main state persistence)`);
process.exit(failures === 0 ? 0 : 1);
