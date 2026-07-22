import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { analyzeSource } from './semantic-lint-core.mjs';
import './semantic-lint.test.mjs';

const execFileAsync = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;
const roots = ['src', 'functions', 'scripts'];
const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.css']);
const semanticExtensions = new Set(['.ts', '.tsx']);
const failures = [];
const warnings = [];

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.wrangler')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else if (extensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

async function gitNames(args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: root });
    return stdout.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function changedSemanticFiles() {
  const names = new Set([
    ...await gitNames(['diff', '--name-only', '--diff-filter=ACMR']),
    ...await gitNames(['diff', '--cached', '--name-only', '--diff-filter=ACMR']),
  ]);
  if (process.env.GITHUB_BASE_REF) {
    for (const name of await gitNames([
      'diff',
      '--name-only',
      '--diff-filter=ACMR',
      `origin/${process.env.GITHUB_BASE_REF}...HEAD`,
    ])) names.add(name);
  } else {
    for (const name of await gitNames(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD^', 'HEAD'])) names.add(name);
  }
  return new Set([...names].filter((name) => semanticExtensions.has(extname(name))));
}

const allFiles = [];
for (const directory of roots) allFiles.push(...await filesBelow(join(root, directory)));

for (const path of allFiles) {
  const name = relative(root, path);
  const source = await readFile(path, 'utf8');
  source.split(/\r?\n/u).forEach((line, index) => {
    if (/[\t ]+$/u.test(line)) failures.push(`${name}:${index + 1}: trailing whitespace`);
    if (/^(?:<{7}|={7}|>{7})/u.test(line)) failures.push(`${name}:${index + 1}: conflict marker`);
  });
  if (name.startsWith('src/features/memory/') && /dangerouslySetInnerHTML/u.test(source)) {
    failures.push(`${name}: imported/AI text must never be rendered as HTML`);
  }
  if (name.startsWith('src/features/memory/') && /\b(?:dueDate|nextReviewAt)\b/u.test(source)) {
    failures.push(`${name}: date-based review scheduling is forbidden`);
  }
  if (name.startsWith('functions/') && /api\.cloudflare\.com\/client\/v4/u.test(source)) {
    failures.push(`${name}: use Cloudflare bindings instead of the REST API`);
  }
}

const changed = await changedSemanticFiles();
for (const path of allFiles) {
  const name = relative(root, path);
  if (!changed.has(name)) continue;
  const source = await readFile(path, 'utf8');
  for (const item of analyzeSource(name, source)) {
    const rendered = `${item.file}:${item.line}: [${item.rule}] ${item.message}`;
    if (item.severity === 'warning') warnings.push(rendered);
    else failures.push(rendered);
  }
}

if (warnings.length > 0) console.warn(`Semantic lint warnings:\n${warnings.join('\n')}`);
if (changed.size === 0) console.log('Semantic lint: no changed TypeScript/TSX files');

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Lint checks passed${changed.size > 0 ? ` (${changed.size} semantic file${changed.size === 1 ? '' : 's'})` : ''}`);
