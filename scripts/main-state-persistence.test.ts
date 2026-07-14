/** Regression tests for differential IndexedDB persistence baselines. */
/// <reference types="node" />
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

console.log(failures === 0 ? '\n🎉 ALL PASS (main state persistence)' : `\n💥 ${failures} FAILURES (main state persistence)`);
process.exit(failures === 0 ? 0 : 1);
