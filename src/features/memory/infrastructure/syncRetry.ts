import type { MemorySyncRetryPolicy } from './syncError';

export const MEMORY_SYNC_RETRY_BASE_MS = 2_000;
export const MEMORY_SYNC_TIMEOUT_RETRY_BASE_MS = 1_000;
export const MEMORY_SYNC_OFFLINE_RETRY_BASE_MS = 4_000;
export const MEMORY_SYNC_RETRY_MAX_MS = 60_000;

const RETRYABLE_POLICIES = new Set<MemorySyncRetryPolicy>([
  'when-online',
  'retry-soon',
  'backoff',
]);

export function canScheduleMemorySyncRetry(policy: MemorySyncRetryPolicy | undefined): boolean {
  return policy !== undefined && RETRYABLE_POLICIES.has(policy);
}

function retryBaseMs(policy: MemorySyncRetryPolicy): number {
  if (policy === 'retry-soon') return MEMORY_SYNC_TIMEOUT_RETRY_BASE_MS;
  if (policy === 'when-online') return MEMORY_SYNC_OFFLINE_RETRY_BASE_MS;
  return MEMORY_SYNC_RETRY_BASE_MS;
}

/** Capped exponential delay with ±25% jitter. Attempt numbering starts at 1. */
export function memorySyncRetryDelayMs(
  attempt: number,
  policy: MemorySyncRetryPolicy,
  randomValue = Math.random(),
): number {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  const exponent = Math.min(16, normalizedAttempt - 1);
  const exponential = Math.min(MEMORY_SYNC_RETRY_MAX_MS, retryBaseMs(policy) * (2 ** exponent));
  const boundedRandom = Math.min(1, Math.max(0, Number.isFinite(randomValue) ? randomValue : 0.5));
  const jitterFactor = 0.75 + boundedRandom * 0.5;
  return Math.min(MEMORY_SYNC_RETRY_MAX_MS, Math.max(1, Math.round(exponential * jitterFactor)));
}

interface MemorySyncRetryControllerDependencies {
  now?: () => number;
  random?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * One controller belongs to one active memory repository. It suppresses every
 * automatic trigger while a retry timer is pending, but manual/recovery actions
 * can call bypass() and run immediately.
 */
export class MemorySyncRetryController {
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private timer: unknown;
  private failures = 0;
  private scheduledAt = 0;

  constructor(dependencies: MemorySyncRetryControllerDependencies = {}) {
    this.now = dependencies.now ?? (() => Date.now());
    this.random = dependencies.random ?? Math.random;
    this.setTimer = dependencies.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = dependencies.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  get failureCount(): number {
    return this.failures;
  }

  get retryAt(): number | null {
    return this.timer === undefined ? null : this.scheduledAt;
  }

  isWaiting(): boolean {
    return this.timer !== undefined && this.now() < this.scheduledAt;
  }

  schedule(policy: MemorySyncRetryPolicy | undefined, onRetry: () => void): number | null {
    if (!canScheduleMemorySyncRetry(policy)) {
      this.markStable();
      return null;
    }
    this.clearScheduledTimer();
    this.failures += 1;
    const delayMs = memorySyncRetryDelayMs(this.failures, policy, this.random());
    this.scheduledAt = this.now() + delayMs;
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      this.scheduledAt = 0;
      onRetry();
    }, delayMs);
    return delayMs;
  }

  /** User action or a concrete online event invalidates the previous wait. */
  bypass(): void {
    this.clearScheduledTimer();
    this.failures = 0;
  }

  markStable(): void {
    this.clearScheduledTimer();
    this.failures = 0;
  }

  dispose(): void {
    this.markStable();
  }

  private clearScheduledTimer(): void {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
    this.scheduledAt = 0;
  }
}
