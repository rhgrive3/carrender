import type { MemoryStat } from '../domain/types';

const HIGH_STRING = '\uffff';
export type DateIdCursor = readonly [date: string, id: string];

export function cursorPageLimit(value: number, fallback: number, maximum = 1_000): number {
  const finite = Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1, Math.min(maximum, finite));
}

export function encodeDateIdCursor(date: string, id: string): string {
  return JSON.stringify([date, id]);
}

export function decodeDateIdCursor(value: string | undefined): DateIdCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      && parsed.length === 2
      && parsed.every((part) => typeof part === 'string')
      ? [parsed[0], parsed[1]]
      : undefined;
  } catch {
    return undefined;
  }
}

/** Range for a compound index whose first component is a stable string id. */
export function compoundPrefixRange(prefix: string): IDBKeyRange {
  return IDBKeyRange.bound([prefix, ''], [prefix, HIGH_STRING, HIGH_STRING]);
}

export function descendingDateIdRange(cursor: DateIdCursor | undefined): IDBKeyRange | undefined {
  return cursor ? IDBKeyRange.upperBound([...cursor], true) : undefined;
}

export function descendingCompoundRange(prefix: string, cursor: DateIdCursor | undefined): IDBKeyRange {
  return IDBKeyRange.bound(
    [prefix, ''],
    cursor ? [prefix, ...cursor] : [prefix, HIGH_STRING, HIGH_STRING],
    false,
    Boolean(cursor),
  );
}

export function attemptHistoryIndex(targetType: MemoryStat['targetType']): string {
  if (targetType === 'sense') return 'senseCreatedAtId';
  if (targetType === 'answer') return 'answerCreatedAtId';
  return 'exerciseCreatedAtId';
}
