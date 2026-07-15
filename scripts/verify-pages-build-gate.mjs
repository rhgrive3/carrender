const REQUIRED_D1_SCHEMA_VERSION = 5;
const isCloudflarePagesBuild = process.env.CF_PAGES === '1';
const passedVersion = Number(process.env.MIGRATION_GATE_PASSED ?? 0);

if (!isCloudflarePagesBuild) process.exit(0);

if (Number.isInteger(passedVersion) && passedVersion >= REQUIRED_D1_SCHEMA_VERSION) {
  console.log(`✅ D1 migration gate passed at schema v${passedVersion}`);
  process.exit(0);
}

console.error([
  `❌ Cloudflare Pages build blocked: D1 schema v${REQUIRED_D1_SCHEMA_VERSION} has not been verified.`,
  'MIGRATION_GATE_PASSED must be an integer schema version produced by the gated production workflow.',
  'Use the GitHub Actions production workflow, which runs migrations and verifies app_schema_version before deployment.',
  'Do not bypass this with a permanent environment variable; MIGRATION_GATE_PASSED is set only for the gated build step.',
].join('\n'));
process.exit(1);
