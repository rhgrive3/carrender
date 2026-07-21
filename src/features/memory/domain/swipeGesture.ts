export interface MemoryPointerGesture {
  pointerId: number;
  x: number;
  y: number;
}

export interface MemoryPointerEnd extends MemoryPointerGesture {
  isPrimary: boolean;
}

export type MemorySwipeDirection = 'left' | 'right';

export function memorySwipeDirection(
  start: MemoryPointerGesture | null,
  end: MemoryPointerEnd,
  threshold = 48,
): MemorySwipeDirection | null {
  if (!start || !end.isPrimary || end.pointerId !== start.pointerId) return null;
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  if (absX < threshold || absX <= absY) return null;
  return deltaX < 0 ? 'left' : 'right';
}
