import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const main = read('src/main.tsx');
const css = read('src/styles/accessibility-polish.css');

assert.match(main, /<a className="skip-link" href="#app-main-content">本文へ移動<\/a>/);
assert.match(main, /<main id="app-main-content" tabIndex=\{-1\}>/);
assert.match(css, /\.skip-link\s*\{[\s\S]*position:\s*fixed/);
assert.match(css, /\.skip-link:focus-visible\s*\{[\s\S]*transform:\s*translateY\(0\)/);
assert.match(css, /\.skip-link\s*\{[\s\S]*safe-area-inset-top/);
assert.match(css, /\.skip-link\s*\{[\s\S]*min-height:\s*44px/);
assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*\.skip-link\s*\{[\s\S]*transition:\s*none/);

console.log('✅ Skip link and main landmark contracts passed');
