export interface AsyncOwnerGenerationToken {
  owner: string | null;
  generation: number;
}

/**
 * Invalidates asynchronous work as soon as the authenticated owner changes.
 * AbortController remains useful for transport cancellation; this guard is the
 * final boundary that prevents an already-settled request from mutating the
 * next owner's refs, UI state, or durable sync metadata.
 */
export class AsyncOwnerGenerationGuard {
  private owner: string | null;
  private generation = 0;

  constructor(owner: string | null) {
    this.owner = owner;
  }

  updateOwner(owner: string | null): void {
    if (this.owner === owner) return;
    this.owner = owner;
    this.generation += 1;
  }

  capture(): AsyncOwnerGenerationToken {
    return { owner: this.owner, generation: this.generation };
  }

  isCurrent(token: AsyncOwnerGenerationToken): boolean {
    return token.owner === this.owner && token.generation === this.generation;
  }
}
