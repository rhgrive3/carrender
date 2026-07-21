export const MEMORY_SWIPE_THRESHOLD_PX = 48;

export interface MemorySwipeStart {
  pointerId: number;
  x: number;
  y: number;
}

export type MemorySwipeDirection = 'left' | 'right';

export function memorySwipeDirection(
  start: MemorySwipeStart | null,
  input: { pointerId: number; x: number; y: number; isPrimary: boolean },
): MemorySwipeDirection | null {
  if (!start || !input.isPrimary || input.pointerId !== start.pointerId) return null;
  const deltaX = input.x - start.x;
  const deltaY = input.y - start.y;
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  if (absX < MEMORY_SWIPE_THRESHOLD_PX || absX <= absY) return null;
  return deltaX < 0 ? 'left' : 'right';
}
