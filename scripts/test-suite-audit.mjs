import { readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import assert from 'node:assert/strict';

const root = process.cwd();
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const scripts = packageJson.scripts ?? {};

const SUITE_KEYS = [
  'test:unit',
  'test:smoke',
  'test:regressions',
  'test:scheduler',
  'test:shadow',
  'test:performance',
  'test:integration:browser',
  'test:integration:api',
  'test:e2e',
];

const DOMAIN_RULES = [
  ['memory', /memory/i],
  ['scheduler', /scheduler|strict-plan|strict-solver|fixed-event|shadow-allocation|material-schedule/i],
  ['state-sync', /main-state|main-sync|app-state|owner-identity|writer-lease/i],
  ['record-timer', /record|timer|session-started|doing-task/i],
  ['pwa-ios', /service-worker|pages-build|deploy-workflow|emergency-cache|bottom-navigation/i],
  ['accessibility-ux', /accessibility|landmark|skip-link|navigation-announcement|touch-target|toast|sheet|keyboard/i],
  ['auth-api', /auth|api-client|data-api/i],
  ['data-integrity', /integrity|validation|backup|schema|date-validation|settings-recovery/i],
];

function commandFiles(command = '') {
  const files = [];
  for (const match of command.matchAll(/(?:^|\s)(scripts\/[\w./-]+\.(?:ts|mjs|js))(?=\s|$)/g)) files.push(match[1]);
  return files;
}

function domainFor(file) {
  return DOMAIN_RULES.find(([, pattern]) => pattern.test(file))?.[0] ?? 'other';
}

async function discoverTestFiles(directory = path.join(root, 'scripts')) {
  const found = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (/\.(?:test|fixture)\.(?:ts|mjs|js)$/.test(entry.name)) found.push(path.relative(root, absolute).replaceAll(path.sep, '/'));
    }
  }
  await walk(directory);
  return found.sort();
}

export function buildManifest(scriptMap = scripts) {
  return SUITE_KEYS.flatMap((suite) => commandFiles(scriptMap[suite]).map((file) => ({ suite, file, domain: domainFor(file) })));
}

export async function auditManifest(scriptMap = scripts, discovered = await discoverTestFiles()) {
  const manifest = buildManifest(scriptMap);
  const byFile = new Map();
  for (const entry of manifest) byFile.set(entry.file, [...(byFile.get(entry.file) ?? []), entry.suite]);
  const duplicates = [...byFile.entries()].filter(([, suites]) => suites.length > 1);
  const registered = new Set(byFile.keys());
  const intentionallyStandalone = new Set([
    'scripts/test-suite-audit.mjs',
  ]);
  const unregistered = discovered.filter((file) => !registered.has(file) && !intentionallyStandalone.has(file));
  const missing = manifest.filter(({ file }) => !discovered.includes(file) && /\.(?:test|fixture)\./.test(file));
  const domains = new Map();
  for (const entry of manifest) domains.set(entry.domain, (domains.get(entry.domain) ?? 0) + 1);
  return { manifest, duplicates, unregistered, missing, domains };
}

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

async function runCommand(command) {
  const started = performance.now();
  const child = spawn(command, { cwd: root, shell: true, stdio: 'inherit', env: process.env });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (value) => resolve(value ?? 1));
  });
  return { command, code, durationMs: performance.now() - started };
}

async function runSuite(key) {
  const source = scripts[key];
  if (!source) throw new Error(`Unknown package script: ${key}`);
  const commands = source.split(/\s*&&\s*/).filter(Boolean);
  const results = [];
  for (const command of commands) {
    const result = await runCommand(command);
    results.push(result);
    console.log(`[suite] ${result.code === 0 ? 'PASS' : 'FAIL'} ${formatDuration(result.durationMs)} ${command}`);
    if (result.code !== 0) break;
  }
  console.log('\n[suite summary]');
  for (const result of results) console.log(`${result.code === 0 ? 'PASS' : 'FAIL'}\t${formatDuration(result.durationMs)}\t${result.command}`);
  if (results.some(({ code }) => code !== 0)) process.exitCode = 1;
}

function printAudit(report) {
  console.log(`[test manifest] ${report.manifest.length} entries across ${SUITE_KEYS.length} categories`);
  for (const key of SUITE_KEYS) {
    const count = report.manifest.filter(({ suite }) => suite === key).length;
    console.log(`- ${key}: ${count}`);
  }
  console.log('[domain coverage]');
  for (const [domain, count] of [...report.domains.entries()].sort()) console.log(`- ${domain}: ${count}`);
  if (report.duplicates.length) console.error('Duplicate test registration:', report.duplicates);
  if (report.unregistered.length) console.error('Unregistered test files:', report.unregistered);
  if (report.missing.length) console.error('Registered test files not found:', report.missing.map(({ file, suite }) => `${file} (${suite})`));
}

async function selfTest() {
  const sample = {
    'test:unit': 'vite-node scripts/example.test.ts',
    'test:regressions': 'node scripts/example.test.ts && node scripts/other.test.mjs',
  };
  const report = await auditManifest(sample, ['scripts/example.test.ts', 'scripts/other.test.mjs', 'scripts/new.test.ts']);
  assert.deepEqual(report.duplicates, [['scripts/example.test.ts', ['test:unit', 'test:regressions']]]);
  assert.deepEqual(report.unregistered, ['scripts/new.test.ts']);
  assert.equal(report.missing.length, 0);
  assert.equal(report.manifest.find(({ file }) => file === 'scripts/other.test.mjs')?.domain, 'other');
  console.log('✅ test suite audit self-test passed');
}

const args = process.argv.slice(2);
if (args[0] === '--run') {
  await runSuite(args[1]);
} else if (args[0] === '--self-test') {
  await selfTest();
} else {
  const report = await auditManifest();
  printAudit(report);
  if (report.duplicates.length || report.unregistered.length || report.missing.length) process.exitCode = 1;
}
