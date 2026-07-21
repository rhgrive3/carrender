import assert from 'node:assert/strict';
import { memorySwipeDirection } from '../src/features/memory/ui/memorySwipeGesture';

const start = { pointerId: 7, x: 100, y: 100 };

assert.equal(
  memorySwipeDirection(start, { pointerId: 7, x: 155, y: 280, isPrimary: true }),
  null,
  '縦移動が支配的な斜めドラッグはカード反転へ変換しない',
);
assert.equal(
  memorySwipeDirection(start, { pointerId: 7, x: -80, y: 155, isPrimary: true }),
  'left',
  '横移動が支配的な左スワイプは答え面へ進める',
);
assert.equal(
  memorySwipeDirection(start, { pointerId: 7, x: 280, y: 155, isPrimary: true }),
  'right',
  '横移動が支配的な右スワイプは問題面へ戻せる',
);
assert.equal(
  memorySwipeDirection(start, { pointerId: 7, x: 147, y: 100, isPrimary: true }),
  null,
  '閾値未満の移動はスワイプとして扱わない',
);
assert.equal(
  memorySwipeDirection(start, { pointerId: 8, x: -80, y: 100, isPrimary: true }),
  null,
  '開始時と異なるpointerIdの終了イベントを無視する',
);
assert.equal(
  memorySwipeDirection(start, { pointerId: 7, x: -80, y: 100, isPrimary: false }),
  null,
  '非primary pointerを無視する',
);
assert.equal(
  memorySwipeDirection(start, { pointerId: 7, x: 148, y: 148, isPrimary: true }),
  null,
  '縦横同量の移動はスクロール優先で反転しない',
);

console.log('✅ memory swipe gesture direction passed');
