import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.match(source, /function MainLandmarkGuard\(\)/u, 'nested main landmark guard must exist');
assert.match(source, /rootMain\.querySelectorAll<HTMLElement>\('main'\)/u, 'nested main elements must be normalized under the app main');
assert.match(source, /nestedMain\.setAttribute\('role', 'region'\)/u, 'nested main elements must no longer expose duplicate main landmarks');
assert.match(source, /nestedMain\.setAttribute\('aria-label', '画面の主要コンテンツ'\)/u, 'normalized regions must retain an accessible name');
assert.match(source, /new MutationObserver\(normalizeNestedMain\)/u, 'lazy-mounted tab screens must also be normalized');
assert.match(source, /<MainLandmarkGuard \/>[\s\S]*?<main id="app-main-content"/u, 'the guard must run alongside the single app-level main');

console.log('✅ app exposes one main landmark while preserving nested screen regions');
