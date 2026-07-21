import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/features/memory/ui/MemoryStudy.tsx', import.meta.url), 'utf8');

assert.match(source, /pointerId:\s*event\.pointerId,\s*x:\s*event\.clientX,\s*y:\s*event\.clientY/, '開始pointerのIDとXY座標を保存する');
assert.match(source, /memorySwipeDirection\(start,\s*\{[\s\S]*pointerId:\s*event\.pointerId[\s\S]*x:\s*event\.clientX[\s\S]*y:\s*event\.clientY[\s\S]*isPrimary:\s*event\.isPrimary/, '終了時に同一pointerとXY移動量を純関数へ渡す');
assert.match(source, /onPointerCancel=\{\(\) => \{ pointerStart\.current = null; ignoreNextClick\.current = false; \}\}/, 'pointercancel後に開始情報とclick抑止を残さない');
assert.match(source, /const beginAction = \(\) => \{[\s\S]*pointerStart\.current = null;[\s\S]*ignoreNextClick\.current = false;/, '回答保存や取消の開始時に進行中gestureを破棄する');

console.log('✅ memory swipe integration contract passed');
