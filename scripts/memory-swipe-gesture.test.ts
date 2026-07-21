import assert from 'node:assert/strict';
import { memorySwipeDirection } from '../src/features/memory/domain/swipeGesture';

const start = { pointerId: 7, x: 100, y: 100 };
assert.equal(memorySwipeDirection(start, { pointerId: 7, x: 155, y: 280, isPrimary: true }), null, 'vertical-dominant diagonal remains a scroll');
assert.equal(memorySwipeDirection(start, { pointerId: 7, x: -80, y: 155, isPrimary: true }), 'left', 'horizontal-dominant left swipe advances');
assert.equal(memorySwipeDirection(start, { pointerId: 7, x: 280, y: 155, isPrimary: true }), 'right', 'horizontal-dominant right swipe returns');
assert.equal(memorySwipeDirection(start, { pointerId: 7, x: 147, y: 100, isPrimary: true }), null, 'movement below threshold is not a swipe');
assert.equal(memorySwipeDirection(start, { pointerId: 7, x: 148, y: 100, isPrimary: true }), 'right', 'threshold is inclusive');
assert.equal(memorySwipeDirection(start, { pointerId: 8, x: 280, y: 100, isPrimary: true }), null, 'different pointer cannot finish the gesture');
assert.equal(memorySwipeDirection(start, { pointerId: 7, x: 280, y: 100, isPrimary: false }), null, 'non-primary pointer is ignored');
assert.equal(memorySwipeDirection(null, { pointerId: 7, x: 280, y: 100, isPrimary: true }), null, 'cancelled gesture stays cancelled');
console.log('memory swipe dominant-axis regressions passed');
