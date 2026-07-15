import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const gateScript = fileURLToPath(new URL('./verify-pages-build-gate.mjs', import.meta.url));

function runGate(env = {}) {
  const childEnv = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === null) delete childEnv[key];
    else childEnv[key] = value;
  }
  return spawnSync(process.execPath, [gateScript], {
    env: childEnv,
    encoding: 'utf8',
  });
}

assert.equal(runGate({ CF_PAGES: '0', MIGRATION_GATE_PASSED: 'not-a-version' }).status, 0, 'Cloudflare Pages以外のbuildはgate対象外');

const automaticPagesBuild = runGate({ CF_PAGES: '1', MIGRATION_GATE_PASSED: null });
assert.equal(automaticPagesBuild.status, 0, 'Cloudflare Pagesの通常Git buildはmigration証明なしでも成功する');
assert.match(automaticPagesBuild.stderr, /continuing without D1 migration verification/);

const emptyVersion = runGate({ CF_PAGES: '1', MIGRATION_GATE_PASSED: '' });
assert.equal(emptyVersion.status, 0, '空のmigration証明は未設定と同様に扱う');

assert.equal(runGate({ CF_PAGES: '1', MIGRATION_GATE_PASSED: '5' }).status, 0, '検証済み整数versionは通す');

for (const invalidVersion of ['5.1', 'Infinity', 'NaN', 'not-a-version']) {
  const result = runGate({ CF_PAGES: '1', MIGRATION_GATE_PASSED: invalidVersion });
  assert.equal(result.status, 1, `${invalidVersion}をschema versionとして受理しない`);
  assert.match(result.stderr, /must be an integer schema version at least v5/);
}

assert.equal(runGate({ CF_PAGES: '1', MIGRATION_GATE_PASSED: '4' }).status, 1, '要求version未満は通さない');

console.log('✅ Pages build migration gate regressions passed');
