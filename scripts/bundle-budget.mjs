import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createGzip } from 'node:zlib';

const DIST = new URL('../dist/', import.meta.url);
const MAX_TOTAL_JS_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_JS_GZIP_BYTES = 1536 * 1024;
const MAX_SINGLE_JS_GZIP_BYTES = 1024 * 1024;
const MAX_TOTAL_CSS_GZIP_BYTES = 512 * 1024;

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function gzipSize(path) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const gzip = createGzip({ level: 9 });
    gzip.on('data', (chunk) => { bytes += chunk.length; });
    gzip.once('error', reject);
    gzip.once('end', () => resolve(bytes));
    createReadStream(path).once('error', reject).pipe(gzip);
  });
}

function fail(message) {
  console.error(`  ❌ ${message}`);
  process.exitCode = 1;
}

const root = DIST.pathname;
const files = await walk(root);
const assets = [];
for (const path of files) {
  if (!/\.(?:js|css)$/u.test(path)) continue;
  const info = await stat(path);
  assets.push({
    path,
    name: relative(root, path),
    type: path.endsWith('.js') ? 'js' : 'css',
    bytes: info.size,
    gzipBytes: await gzipSize(path),
  });
}

const js = assets.filter((asset) => asset.type === 'js');
const css = assets.filter((asset) => asset.type === 'css');
const totalJs = js.reduce((sum, asset) => sum + asset.bytes, 0);
const totalJsGzip = js.reduce((sum, asset) => sum + asset.gzipBytes, 0);
const totalCssGzip = css.reduce((sum, asset) => sum + asset.gzipBytes, 0);
const largestJs = [...js].sort((left, right) => right.gzipBytes - left.gzipBytes)[0];

console.log('--- Production bundle budget ---');
for (const asset of [...assets].sort((left, right) => right.gzipBytes - left.gzipBytes)) {
  console.log(`  ${asset.name}: ${asset.bytes} bytes (${asset.gzipBytes} gzip)`);
}

if (js.length === 0) fail('production build did not emit JavaScript');
if (totalJs > MAX_TOTAL_JS_BYTES) fail(`total JavaScript ${totalJs} > ${MAX_TOTAL_JS_BYTES}`);
if (totalJsGzip > MAX_TOTAL_JS_GZIP_BYTES) fail(`total gzipped JavaScript ${totalJsGzip} > ${MAX_TOTAL_JS_GZIP_BYTES}`);
if (largestJs && largestJs.gzipBytes > MAX_SINGLE_JS_GZIP_BYTES) {
  fail(`largest JavaScript asset ${largestJs.name} ${largestJs.gzipBytes} > ${MAX_SINGLE_JS_GZIP_BYTES}`);
}
if (totalCssGzip > MAX_TOTAL_CSS_GZIP_BYTES) fail(`total gzipped CSS ${totalCssGzip} > ${MAX_TOTAL_CSS_GZIP_BYTES}`);

if (!process.exitCode) {
  console.log(`  ✅ JS ${totalJs} bytes / ${totalJsGzip} gzip`);
  console.log(`  ✅ CSS ${totalCssGzip} gzip`);
  console.log('🎉 ALL PASS (bundle budget)');
}
