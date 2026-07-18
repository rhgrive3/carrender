import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/components/ui/bits.tsx', import.meta.url), 'utf8');
const stepper = source.slice(source.indexOf('export function Stepper'), source.indexOf('export function Segmented'));

assert.match(stepper, /label = '値'/, 'Stepper must expose a usable default accessible name');
assert.match(stepper, /role="group" aria-label=\{label\}/, 'Stepper controls must be announced as one named group');
assert.match(stepper, /<output[^>]+aria-live="polite"[^>]+aria-atomic="true"/, 'value changes must be announced atomically');
assert.match(stepper, /aria-label=\{`\$\{label\}を\$\{step\}\$\{suffix\}減らす`\}/, 'decrement control must include context and amount');
assert.match(stepper, /aria-label=\{`\$\{label\}を\$\{step\}\$\{suffix\}増やす`\}/, 'increment control must include context and amount');
assert.match(stepper, /disabled=\{atMin\}/, 'decrement control must expose the lower boundary');
assert.match(stepper, /disabled=\{atMax\}/, 'increment control must expose the upper boundary');
assert.equal((stepper.match(/aria-controls=\{valueId\}/g) ?? []).length, 2, 'both controls must reference the value they update');

console.log('stepper accessibility contract: ok');
