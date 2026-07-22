import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import './service-worker-safe-update.test.mjs';

const workflow = await readFile(new URL('../.github/workflows/deploy-production.yml', import.meta.url), 'utf8');

assert.match(workflow, /id: freshness/);
assert.match(workflow, /git fetch --no-tags origin main/);
assert.match(workflow, /CURRENT_MAIN_SHA="\$\(git rev-parse origin\/main\)"/);
assert.match(workflow, /"\$DEPLOY_SHA" = "\$CURRENT_MAIN_SHA"/);
assert.match(workflow, /deploy_allowed=false/);

const protectedSteps = [
  'Set up Node.js',
  'Require Cloudflare deployment credentials',
  'Install dependencies',
  'Apply production D1 migrations',
  'Verify production D1 schema version',
  'Build only after migration gate',
  'Deploy verified build to Cloudflare Pages',
];

for (const stepName of protectedSteps) {
  const escapedName = stepName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    workflow,
    new RegExp(`- name: ${escapedName}\\n\\s+if: steps\\.freshness\\.outputs\\.deploy_allowed == 'true'`),
    `${stepName} must be skipped for stale workflow_run revisions`,
  );
}

console.log('deploy workflow freshness guard regression: ok');
