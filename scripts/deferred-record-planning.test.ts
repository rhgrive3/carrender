import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addDays, today } from '../src/lib/date';
import {
  canApplyDeferredPlan,
  createDeferredScheduler,
  DeferredPlanCancelledError,
} from '../src/lib/deferredScheduler';
import { prepareSessionMutation } from '../src/lib/sessionMutation';
import { emptyState } from '../src/state/AppContextBase';
import type { AppState } from '../src/types';

const base: AppState = {
  ...emptyState(),
  onboarded: true,
  lastPlanReason: 'existing-plan',
  subjects: [{ id: 'subject-1', name: '英語', color: '#000000', importance: 3, weakness: 3 }],
};

const prepared = prepareSessionMutation(base, {
  type: 'RECORD_SESSION',
  input: {
    taskId: null,
    subjectId: 'subject-1',
    materialId: null,
    minutes: 30,
    amountDone: 0,
    focus: 4,
    memo: '',
    source: 'manual',
    rangeLabel: '',
    completedTask: false,
  },
}, today());
assert.ok(prepared, '記録transactionを作成できる');
assert.equal(prepared.state.sessions.length, 1, '計画生成前に記録本体をstateへ反映する');
assert.equal(prepared.state.lastPlanReason, 'existing-plan', 'transaction境界では既存計画を同期的に書き換えない');
assert.equal(prepared.replanFrom, addDays(today(), 1), '通常記録は従来どおり翌日から再計画する');

const deleted = prepareSessionMutation(prepared.state, {
  type: 'DELETE_SESSION',
  sessionId: prepared.state.sessions[0].id,
}, today());
assert.ok(deleted);
assert.equal(deleted.state.sessions.length, 0, '削除transactionも計画生成と分離する');
assert.equal(deleted.replanFrom, today());

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<{ ok: true; state: AppState }>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  posted: unknown;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(value: unknown) {
    this.posted = value;
  }

  terminate() {
    this.terminated = true;
  }
}

const originalWorker = globalThis.Worker;
Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker });
try {
  const scheduler = createDeferredScheduler();
  const first = scheduler.request({ state: base, fromDate: today(), reason: 'first' });
  const firstRejection = first.promise.catch((error: unknown) => error);
  const second = scheduler.request({ state: prepared.state, fromDate: today(), reason: 'second' });
  const cancellation = await firstRejection;
  assert.ok(cancellation instanceof DeferredPlanCancelledError, '後続記録は古い計画Promiseを明示cancelする');
  assert.equal(FakeWorker.instances[0].terminated, true, '古いworkerのCPU処理を停止する');

  const planned = { ...prepared.state, lastPlanReason: 'second' };
  FakeWorker.instances[1].onmessage?.({ data: { ok: true, state: planned } } as MessageEvent<{ ok: true; state: AppState }>);
  assert.equal(await second.promise, planned, '最新worker結果だけを受け取る');
  assert.equal(canApplyDeferredPlan(second.generation, scheduler.generation(), prepared.state, prepared.state), true);
  assert.equal(canApplyDeferredPlan(second.generation, scheduler.generation(), prepared.state, { ...prepared.state }), false, '記録後にstateが変化した場合は後着計画を破棄する');
  scheduler.dispose();
} finally {
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: originalWorker });
}

const appContextSource = readFileSync('src/state/AppContextBase.tsx', 'utf8');
const sessionMutationSource = readFileSync('src/lib/sessionMutation.ts', 'utf8');
const transactionSource = readFileSync('src/lib/recordSessionTransaction.ts', 'utf8');
const recordSheetSource = readFileSync('src/components/forms/RecordSheet.tsx', 'utf8');
const workerSource = readFileSync('src/workers/scheduler.worker.ts', 'utf8');
const bannerSource = readFileSync('src/components/SyncStatusBanner.tsx', 'utf8');

assert.doesNotMatch(sessionMutationSource, /state\/AppContext/u, 'session mutation domainからReact contextへの逆依存を作らない');
assert.doesNotMatch(transactionSource, /state\/AppContext/u, '互換adapterもcontext reducerへ循環依存しない');
assert.match(recordSheetSource, /executeSession\(action/u, '記録画面は即時transaction＋遅延計画commandを使う');
assert.doesNotMatch(recordSheetSource, /applyRecordSessionTransaction/u, 'UI event内で同期全計画生成を実行しない');
assert.match(workerSource, /generatePlan/u, '全計画生成をWeb Workerへ隔離する');
assert.match(appContextSource, /canApplyDeferredPlan/u, 'generationとstate identityで後着結果を遮断する');
assert.match(bannerSource, /planningStatus === 'error'[\s\S]*role=\{notice\.tone === 'error' \? 'alert' : 'status'\}/u, '計画失敗をアクセシブルなalertとして区別する');
assert.ok(appContextSource.split('\n').length < 1_200, 'AppContextBaseを責務抽出後のmodule budget内に保つ');

console.log('✅ record transactions commit before worker planning and stale plans cannot overwrite newer state');
