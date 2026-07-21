import assert from 'node:assert/strict';
import { classifyCardGesture } from '../src/features/memory/ui/MemoryStudy';

const start = { pointerId: 7, x: 100, y: 100 };

assert.deepEqual(
  classifyCardGesture(start, { pointerId: 7, x: 155, y: 280 }),
  { moved: true, swipe: null },
  'X55/Y180の縦優位ドラッグをカード反転へしない',
);
assert.deepEqual(
  classifyCardGesture(start, { pointerId: 7, x: -80, y: 155 }),
  { moved: true, swipe: 'left' },
  '左方向が優位なドラッグだけ答え面へのスワイプにする',
);
assert.deepEqual(
  classifyCardGesture(start, { pointerId: 7, x: 280, y: 155 }),
  { moved: true, swipe: 'right' },
  '右方向が優位なドラッグだけ問題面へのスワイプにする',
);
assert.deepEqual(
  classifyCardGesture(start, { pointerId: 7, x: 147, y: 100 }),
  { moved: true, swipe: null },
  '横移動が48px未満なら反転しない',
);
assert.deepEqual(
  classifyCardGesture(start, { pointerId: 7, x: 148, y: 148 }),
  { moved: true, swipe: null },
  '横と縦が同量の斜め操作を反転にしない',
);
assert.deepEqual(
  classifyCardGesture(start, { pointerId: 8, x: 280, y: 100 }),
  { moved: false, swipe: null },
  '開始と異なるpointerIdの終了を無視する',
);
assert.deepEqual(
  classifyCardGesture(start, { pointerId: 7, x: 104, y: 104 }),
  { moved: false, swipe: null },
  '小さな指ぶれをタップとして残す',
);

console.log('✅ memory study gesture tests passed');
