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
assert.match(css, /#app-main-content:focus:not\(:focus-visible\)\s*\{[\s\S]*outline:\s*none/);
assert.match(css, /#app-main-content:focus-visible\s*\{[\s\S]*outline:\s*3px solid var\(--accent\)/);
assert.match(css, /forced-colors:\s*active[\s\S]*#app-main-content:focus-visible\s*\{[\s\S]*outline-color:\s*Highlight/);
assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*\.skip-link\s*\{[\s\S]*transition:\s*none/);

console.log('✅ Skip link and main landmark contracts passed');
