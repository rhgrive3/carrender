import assert from 'node:assert/strict';
import { solveStrict, type SolverDayInput, type SolverItem } from '../src/lib/strictSolver';

const item: SolverItem = {
  id: 'deterministic-long-search',
  release: '2026-07-23',
  deadline: '2026-07-23',
  requiredUnits: 70,
  minutesPerUnit: 1,
  unitStep: 1,
  minChunkUnits: 1,
  maxChunkUnits: 1,
  splittable: true,
  maxUnitsPerDay: 70,
};
const days: SolverDayInput[] = [{ date: '2026-07-23', slots: [{ start: 0, end: 100 }], budget: 100 }];

function allocationHash(result: ReturnType<typeof solveStrict>): string {
  return JSON.stringify([...result.allocations.entries()].map(([id, rows]) => [id, rows]));
}

const originalNow = Date.now;
try {
  let slowClock = 0;
  Date.now = () => { slowClock += 10_000; return slowClock; };
  const slow = solveStrict([item], days, { maxNodes: 1_000, maxMs: 0, preferLate: false });

  let fastClock = 0;
  Date.now = () => fastClock++;
  const fast = solveStrict([item], days, { maxNodes: 1_000, maxMs: 0, preferLate: false });

  assert.equal(slow.status, 'feasible', 'wall-clockが大きく進んでも通常探索を打ち切らない');
  assert.equal(fast.status, 'feasible');
  assert.equal(allocationHash(slow), allocationHash(fast), '端末速度相当の時計差で配置結果を変えない');
  assert.equal(slow.exhaustive, true);

  const limited = solveStrict([item], days, { maxNodes: 10, maxMs: 60_000, preferLate: false });
  assert.equal(limited.status, 'indeterminate');
  assert.equal(limited.exhaustive, false, 'node budget終了を完全探索として扱わない');
  assert.equal(limited.limitReason, 'nodeBudget');

  let checks = 0;
  const cancelled = solveStrict([item], days, {
    maxNodes: 1_000,
    maxMs: 60_000,
    preferLate: false,
    emergencyStop: () => ++checks >= 1,
  });
  assert.equal(cancelled.status, 'indeterminate');
  assert.equal(cancelled.limitReason, 'emergencyStop');
  assert.equal(cancelled.exhaustive, false);
} finally {
  Date.now = originalNow;
}

console.log('✅ strict solver deterministic budget contracts passed');
