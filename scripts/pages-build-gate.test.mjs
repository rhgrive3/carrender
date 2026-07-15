import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const gateScript = fileURLToPath(new URL('./verify-pages-build-gate.mjs', import.meta.url));

function runGate(env = {}) {
  return spawnSync(process.execPath, [gateScript], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

assert.equal(runGate({ CF_PAGES: '0', MIGRATION_GATE_PASSED: 'not-a-version' }).status, 0, 'Cloudflare Pages以外のbuildはgate対象外');
assert.equal(runGate({ CF_PAGES: '1', MIGRATION_GATE_PASSED: '5' }).status, 0, '検証済み整数versionは通す');

for (const invalidVersion of ['5.1', 'Infinity', 'NaN', '']) {
  const result = runGate({ CF_PAGES: '1', MIGRATION_GATE_PASSED: invalidVersion });
  assert.equal(result.status, 1, `${invalidVersion || '空文字'}をschema versionとして受理しない`);
  assert.match(result.stderr, /must be an integer schema version/);
}

assert.equal(runGate({ CF_PAGES: '1', MIGRATION_GATE_PASSED: '4' }).status, 1, '要求version未満は通さない');

console.log('✅ Pages build migration gate regressions passed');
