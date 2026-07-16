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
assert.match(source, /let bodyOverflowState: string \| null = null/);
assert.match(source, /if \(modalStack\.length === 0\) \{[\s\S]*bodyOverflowState = document\.body\.style\.overflow;[\s\S]*document\.body\.style\.overflow = 'hidden'/);
assert.match(source, /if \(modalStack\.length !== 0\) return;[\s\S]*document\.body\.style\.overflow = bodyOverflowState/);
assert.doesNotMatch(source, /const prev = document\.body\.style\.overflow/);

console.log('✅ Stacked sheets expose only the topmost dialog and retain scroll lock');
