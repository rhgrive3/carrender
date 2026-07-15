const REQUIRED_D1_SCHEMA_VERSION = 5;
const isCloudflarePagesBuild = process.env.CF_PAGES === '1';
const rawPassedVersion = process.env.MIGRATION_GATE_PASSED?.trim();

if (!isCloudflarePagesBuild) process.exit(0);

if (!rawPassedVersion) {
  console.warn([
    '⚠️ Cloudflare Pages Git build is continuing without D1 migration verification.',
    `The runtime schema compatibility gate will block incompatible app startup if production D1 is below v${REQUIRED_D1_SCHEMA_VERSION}.`,
    'Use the GitHub Actions production workflow whenever a deployment includes D1 schema migrations.',
  ].join('\n'));
  process.exit(0);
}

const passedVersion = Number(rawPassedVersion);
if (Number.isInteger(passedVersion) && passedVersion >= REQUIRED_D1_SCHEMA_VERSION) {
  console.log(`✅ D1 migration gate passed at schema v${passedVersion}`);
  process.exit(0);
}

console.error([
  '❌ Invalid MIGRATION_GATE_PASSED value.',
  `MIGRATION_GATE_PASSED must be an integer schema version at least v${REQUIRED_D1_SCHEMA_VERSION}.`,
  'Remove the variable for ordinary Cloudflare Pages Git builds, or set it only from the verified GitHub Actions production workflow.',
].join('\n'));
process.exit(1);
