const SMART_SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B\u2032\u02BC\uFF07]/g;
const SMART_DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u2033]/g;
const TRAILING_SENTENCE_PUNCTUATION = /[.!?。！？]+$/u;

/**
 * Normalizes presentation-only differences without removing words or symbols that
 * can change the meaning of an English expression.
 */
export function normalizeAnswerText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(SMART_SINGLE_QUOTES, "'")
    .replace(SMART_DOUBLE_QUOTES, '"')
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(TRAILING_SENTENCE_PUNCTUATION, '')
    .trim()
    .toLocaleLowerCase('en-US');
}

/** Broader normalization for local search; punctuation is retained. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(SMART_SINGLE_QUOTES, "'")
    .replace(SMART_DOUBLE_QUOTES, '"')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('en-US');
}

export function tokenizeAnswer(value: string): string[] {
  const normalized = normalizeAnswerText(value);
  return normalized === '' ? [] : normalized.split(/\s+/u);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Converts patterns such as `take {object} into account` to an anchored matcher.
 * Placeholders must contain at least one non-space character, so a missing object
 * never becomes a match. Literal parts still receive normal answer normalization.
 */
export function compileAnswerPattern(pattern: string): RegExp | null {
  const normalized = normalizeAnswerText(pattern);
  if (normalized === '') return null;

  const placeholder = /\{([a-z][a-z0-9_-]*)\}/giu;
  let cursor = 0;
  let source = '';
  let found = false;
  for (const match of normalized.matchAll(placeholder)) {
    const index = match.index;
    if (index === undefined) continue;
    found = true;
    source += escapeRegExp(normalized.slice(cursor, index)).replace(/\\ /g, '\\s+');
    source += '(?:\\S(?:.*?\\S)?)';
    cursor = index + match[0].length;
  }
  if (!found) return null;
  source += escapeRegExp(normalized.slice(cursor)).replace(/\\ /g, '\\s+');
  return new RegExp(`^${source}$`, 'iu');
}

export function matchesAnswerPattern(value: string, pattern: string): boolean {
  const matcher = compileAnswerPattern(pattern);
  return matcher?.test(normalizeAnswerText(value)) ?? false;
}

/** True Damerau-Levenshtein distance with adjacent transpositions. */
export function damerauLevenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const a = Array.from(left);
  const b = Array.from(right);
  const rows = a.length + 2;
  const cols = b.length + 2;
  const maxDistance = a.length + b.length;
  const matrix = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  const lastSeen = new Map<string, number>();

  matrix[0][0] = maxDistance;
  for (let i = 0; i <= a.length; i += 1) {
    matrix[i + 1][0] = maxDistance;
    matrix[i + 1][1] = i;
  }
  for (let j = 0; j <= b.length; j += 1) {
    matrix[0][j + 1] = maxDistance;
    matrix[1][j + 1] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    let lastMatchColumn = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const transpositionRow = lastSeen.get(b[j - 1]) ?? 0;
      const transpositionColumn = lastMatchColumn;
      let substitutionCost = 1;
      if (a[i - 1] === b[j - 1]) {
        substitutionCost = 0;
        lastMatchColumn = j;
      }
      matrix[i + 1][j + 1] = Math.min(
        matrix[i][j] + substitutionCost,
        matrix[i + 1][j] + 1,
        matrix[i][j + 1] + 1,
        matrix[transpositionRow][transpositionColumn]
          + (i - transpositionRow - 1)
          + 1
          + (j - transpositionColumn - 1),
      );
    }
    lastSeen.set(a[i - 1], i);
  }

  return matrix[a.length + 1][b.length + 1];
}

export function containsNormalizedToken(answer: string, required: string): boolean {
  const haystack = normalizeAnswerText(answer);
  const needle = normalizeAnswerText(required);
  if (needle === '') return true;
  if (needle.includes(' ')) {
    return (` ${haystack} `).includes(` ${needle} `);
  }
  return tokenizeAnswer(haystack).includes(needle);
}
