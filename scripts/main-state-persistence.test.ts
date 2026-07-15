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

const initial = { version: 1, marker: 'initial' } as unknown as AppState;
const failedSnapshot = { version: 1, marker: 'failed-write' } as unknown as AppState;
const recoveredSnapshot = { version: 1, marker: 'recovered-write' } as unknown as AppState;
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
const firstSnapshot = { version: 1, marker: 'first' } as unknown as AppState;
const secondSnapshot = { version: 1, marker: 'second' } as unknown as AppState;
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

console.log('\n--- Main state persistence: owner isolation ---');
const ownerASnapshot = { version: 1, marker: 'owner-a' } as unknown as AppState;
const ownerBSnapshot = { version: 1, marker: 'owner-b' } as unknown as AppState;
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

console.log(failures === 0 ? '\n🎉 ALL PASS (main state persistence)' : `\n💥 ${failures} FAILURES (main state persistence)`);
process.exit(failures === 0 ? 0 : 1);
