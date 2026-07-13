import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const roots = ['src', 'functions', 'scripts'];
const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.css']);
const failures = [];

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

for (const directory of roots) {
  for (const path of await filesBelow(join(root, directory))) {
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
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Lint checks passed');
