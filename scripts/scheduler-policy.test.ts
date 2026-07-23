import assert from 'node:assert/strict';
import { emptyState } from '../src/state/AppContextBase';
import { generatePlan } from '../src/lib/scheduler';
import { ESTIMATE_POLICY, SCHEDULER_POLICY, SCHEDULER_POLICY_VERSION } from '../src/lib/schedulerPolicy';

assert.equal(ESTIMATE_POLICY.smoothingAlpha, 0.2);
assert.equal(ESTIMATE_POLICY.minimumSamples, 3);
assert.equal(SCHEDULER_POLICY.strictPreferredFinishRatio, 0.85);
assert.equal(SCHEDULER_POLICY.normalPreferredFinishRatio, 0.9);
assert.equal(SCHEDULER_POLICY.reserveProportion, 0.12);
assert.equal(SCHEDULER_POLICY.maximumCapRelaxationAttempts, 12);
assert.equal(SCHEDULER_POLICY.placementCountCap, 33);

const first = generatePlan(emptyState(), '2026-07-23', 'policy regression', {
  now: new Date('2026-07-23T00:00:00.000Z'),
  generationId: 'policy-regression',
});
const second = generatePlan(emptyState(), '2026-07-23', 'policy regression', {
  now: new Date('2026-07-23T00:00:00.000Z'),
  generationId: 'policy-regression',
});
assert.equal(first.state.lastScheduleResult?.policy?.version, SCHEDULER_POLICY_VERSION);
assert.deepEqual(first.state.lastScheduleResult?.policy, second.state.lastScheduleResult?.policy);
assert.deepEqual(first.state.tasks, second.state.tasks, '同一policyと入力では計画結果を決定的に保つ');
console.log('✅ scheduler named policy contracts passed');
