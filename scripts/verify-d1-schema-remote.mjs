import { spawnSync } from 'node:child_process';

const REQUIRED_D1_SCHEMA_VERSION = 5;
const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const query = "SELECT version FROM app_schema_version WHERE component = 'studycommander' LIMIT 1";
const result = spawnSync(executable, [
  'wrangler', 'd1', 'execute', 'studycommander-db', '--remote', '--command', query, '--json',
], {
  encoding: 'utf8',
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'Remote D1 schema query failed\n');
  process.exit(result.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(result.stdout);
} catch {
  process.stderr.write(`Could not parse Wrangler D1 JSON output:\n${result.stdout}\n`);
  process.exit(1);
}

function findVersion(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVersion(item);
      if (found !== null) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  if (Number.isInteger(value.version)) return value.version;
  for (const item of Object.values(value)) {
    const found = findVersion(item);
    if (found !== null) return found;
  }
  return null;
}

const currentVersion = findVersion(payload);
if (currentVersion === null) {
  process.stderr.write('app_schema_version row for studycommander was not found after migration.\n');
  process.exit(1);
}
if (currentVersion < REQUIRED_D1_SCHEMA_VERSION) {
  process.stderr.write(`Remote D1 schema is v${currentVersion}; v${REQUIRED_D1_SCHEMA_VERSION} is required.\n`);
  process.exit(1);
}

console.log(`✅ Remote D1 schema v${currentVersion} satisfies required v${REQUIRED_D1_SCHEMA_VERSION}`);
