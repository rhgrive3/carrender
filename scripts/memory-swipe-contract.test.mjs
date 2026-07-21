import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const study = readFileSync(new URL('../src/features/memory/ui/MemoryStudy.tsx', import.meta.url), 'utf8');
assert.match(study, /interface PointerGesture \{ pointerId: number; x: number; y: number \}/, 'gesture stores pointer identity and both axes');
assert.match(study, /event\.pointerId !== start\.pointerId/, 'a different pointer cannot finish the gesture');
assert.match(study, /const absX = Math\.abs\(deltaX\)[\s\S]*const absY = Math\.abs\(deltaY\)/, 'gesture compares horizontal and vertical movement');
assert.match(study, /absX < SWIPE_THRESHOLD_PX \|\| absX <= absY/, 'only threshold-crossing horizontal-dominant movement flips');
assert.match(study, /onPointerCancel=\{\(\) => \{ pointerGesture\.current = null; \}\}/, 'cancel clears the gesture');
assert.match(study, /pointerGesture\.current = null;[\s\S]*setRevealed\(false\)/, 'session or target changes clear stale gestures');
assert.match(study, /const beginAction = \(\) => \{[\s\S]*pointerGesture\.current = null/, 'busy actions clear stale gestures');
assert.doesNotMatch(study, /pointerStartX/, 'X-only swipe tracking must not return');
console.log('memory study swipe pointer contract passed');
