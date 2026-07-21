import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyCardGesture } from '../src/features/memory/ui/MemoryStudy';

assert.deepEqual(
  classifyCardGesture({ pointerId: 1, x: 0, y: 0 }, { pointerId: 1, x: 55, y: 180 }),
  { moved: true, swipe: null },
  'vertical-dominant answer scrolling must not flip the card',
);
assert.deepEqual(
  classifyCardGesture({ pointerId: 1, x: 200, y: 100 }, { pointerId: 1, x: 20, y: 155 }),
  { moved: true, swipe: 'left' },
  'horizontal-dominant left swipe must reveal the answer',
);
assert.deepEqual(
  classifyCardGesture({ pointerId: 1, x: 20, y: 155 }, { pointerId: 1, x: 200, y: 100 }),
  { moved: true, swipe: 'right' },
  'horizontal-dominant right swipe must return to the question',
);
assert.deepEqual(
  classifyCardGesture({ pointerId: 1, x: 0, y: 0 }, { pointerId: 2, x: 200, y: 0 }),
  { moved: false, swipe: null },
  'a different pointer must not complete another pointer gesture',
);
assert.deepEqual(
  classifyCardGesture({ pointerId: 1, x: 0, y: 0 }, { pointerId: 1, x: 47, y: 0 }),
  { moved: true, swipe: null },
  'movement below the swipe threshold must not flip the card',
);

const guard = await readFile(new URL('../src/lib/tabPanelSemanticsGuard.ts', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

for (const id of [
  'records-tab-overview',
  'records-tab-log',
  'records-panel-overview',
  'records-panel-log',
  'memory-import-tab-import',
  'memory-import-tab-export',
  'memory-import-tab-ai',
  'memory-import-panel-import',
  'memory-import-panel-export',
  'memory-import-panel-ai',
]) {
  assert.match(guard, new RegExp(id), `${id} must be part of the stable tab/panel contract`);
}
assert.match(guard, /tab\.setAttribute\('aria-controls', mapping\.panelId\)/, 'tabs must reference their panels');
assert.match(guard, /actualPanel\.setAttribute\('role', 'tabpanel'\)/, 'visible content must be exposed as a tabpanel');
assert.match(guard, /actualPanel\.setAttribute\('aria-labelledby', mapping\.tabId\)/, 'panels must reference their tabs');
assert.match(guard, /placeholder\.hidden = true/, 'conditionally unmounted panels need hidden placeholders so every aria-controls target remains valid');
assert.match(guard, /group\.setAttribute\('role', 'radiogroup'\)/, 'week/month is a display choice rather than a separate tab panel');
assert.match(guard, /child\.setAttribute\('role', 'radio'\)/, 'week/month controls must use radio semantics');
assert.match(main, /installTabPanelSemanticsGuard\(\)/, 'the tab/panel contract guard must be installed at application startup');

console.log('deep UX audit issues #367-#369 regression tests passed');
