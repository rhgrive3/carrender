const NON_ZERO_FALLBACK = 0x6d2b79f5;

/** Stable 32-bit FNV-1a hash used to initialize deterministic session randomness. */
export function seedToRandomState(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const state = hash >>> 0;
  return state === 0 ? NON_ZERO_FALLBACK : state;
}

export interface RandomStep {
  value: number;
  state: number;
}

/** Serializable xorshift32 step, returning a value in [0, 1). */
export function nextRandom(state: number): RandomStep {
  let next = state >>> 0;
  if (next === 0) next = NON_ZERO_FALLBACK;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  next >>>= 0;
  return { value: next / 0x1_0000_0000, state: next || NON_ZERO_FALLBACK };
}

export function randomIntegerInclusive(
  state: number,
  minimum: number,
  maximum: number,
): { value: number; state: number } {
  const low = Math.ceil(Math.min(minimum, maximum));
  const high = Math.floor(Math.max(minimum, maximum));
  const step = nextRandom(state);
  return { value: low + Math.floor(step.value * (high - low + 1)), state: step.state };
}

export function deterministicShuffle<T>(
  values: readonly T[],
  initialState: number,
): { values: T[]; state: number } {
  const shuffled = [...values];
  let state = initialState;
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const step = randomIntegerInclusive(state, 0, index);
    state = step.state;
    [shuffled[index], shuffled[step.value]] = [shuffled[step.value], shuffled[index]];
  }
  return { values: shuffled, state };
}
