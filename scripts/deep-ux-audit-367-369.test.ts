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

const memoryGuard = await readFile(new URL('../src/lib/memoryImportTabPanelSemantics.ts', import.meta.url), 'utf8');
const recordGuard = await readFile(new URL('../src/lib/recordTabPanelSemantics.ts', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

for (const id of [
  'memory-import-tab-import',
  'memory-import-tab-export',
  'memory-import-tab-ai',
  'memory-import-panel-import',
  'memory-import-panel-export',
  'memory-import-panel-ai',
]) {
  assert.match(memoryGuard, new RegExp(id), `${id} must be part of the stable memory tab/panel contract`);
}
assert.match(memoryGuard, /tab\.setAttribute\('aria-controls', mapping\.panelId\)/, 'memory tabs must reference their panels');
assert.match(memoryGuard, /actualPanel\.setAttribute\('role', 'tabpanel'\)/, 'visible memory content must be exposed as a tabpanel');
assert.match(memoryGuard, /actualPanel\.setAttribute\('aria-labelledby', mapping\.tabId\)/, 'memory panels must reference their tabs');
assert.match(memoryGuard, /placeholder\.hidden = true/, 'conditionally unmounted memory panels need hidden placeholders');
assert.match(main, /installMemoryImportTabPanelSemantics\(\)/, 'the memory tab/panel guard must be installed at application startup');
assert.match(recordGuard, /installRecordTabPanelSemanticsGuard/, 'the existing record tab/panel implementation must remain intact');

console.log('deep UX audit issues #367-#369 regression tests passed');
