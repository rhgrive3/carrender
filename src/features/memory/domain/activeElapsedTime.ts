function safeNow(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Measures only intervals where the study page is visible. Repeated lifecycle
 * events are intentionally idempotent because iOS can emit pagehide together
 * with visibilitychange, and pageshow together with a visible transition.
 */
export class ActiveElapsedTimer {
  private elapsedMs = 0;
  private activeSince: number | undefined;

  constructor(now: number, active: boolean) {
    this.reset(now, active);
  }

  reset(now: number, active: boolean): void {
    this.elapsedMs = 0;
    this.activeSince = active ? safeNow(now) : undefined;
  }

  start(now: number): void {
    if (this.activeSince !== undefined) return;
    this.activeSince = safeNow(now);
  }

  pause(now: number): void {
    if (this.activeSince === undefined) return;
    const stoppedAt = safeNow(now);
    this.elapsedMs += Math.max(0, stoppedAt - this.activeSince);
    this.activeSince = undefined;
  }

  read(now: number): number {
    const current = this.activeSince === undefined
      ? this.elapsedMs
      : this.elapsedMs + Math.max(0, safeNow(now) - this.activeSince);
    return Number.isFinite(current) ? Math.max(0, current) : 0;
  }
}
