import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/ui/Sheet.tsx', import.meta.url), 'utf8');

assert.match(source, /const modalStack: HTMLElement\[\] = \[\]/);
assert.match(source, /const isTopmost = index === modalStack\.length - 1/);
assert.match(source, /backdrop\.setAttribute\('inert', ''\)/);
assert.match(source, /backdrop\.setAttribute\('aria-hidden', 'true'\)/);
assert.match(source, /backdrop\.removeAttribute\('inert'\)/);
assert.match(source, /backdrop\.removeAttribute\('aria-hidden'\)/);
assert.match(source, /if \(backdropRef\.current\?\.hasAttribute\('inert'\)\) return/);
assert.match(source, /ref=\{backdropRef\}/);
assert.match(source, /<h2 className="sheet-title" id=\{titleId\}>\{title\}<\/h2>/);
assert.doesNotMatch(source, /<div className="sheet-title" id=\{titleId\}>/);
assert.match(source, /<div className="sheet-grabber" aria-hidden="true" \/>/);

console.log('✅ Stacked sheets expose only the topmost dialog with a semantic heading');
