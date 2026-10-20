/**
 * A client's reconnect timing: the ceiling doubles from `BaseMs` per failed attempt up to `MaxMs`; each delay lies
 * between half the ceiling and the ceiling. A connection counts as recovered only after it stayed authenticated for
 * `StableMs`.
 */
export interface ReconnectBackoffPolicy {
  readonly BaseMs: number;
  readonly MaxMs: number;
  readonly StableMs: number;
}

/**
 * Capped exponential backoff with equal jitter, shared by every relay client: clients that a relay closed at the same
 * moment spread out, and none retries sooner than half the ceiling. A connection that authenticates and drops again
 * within `StableMs` keeps backing off instead of looping at the base delay.
 */
export class ReconnectBackoff {
  private ceiling: number;
  private authenticatedAt: number | undefined;

  constructor(
    private readonly policy: ReconnectBackoffPolicy,
    private readonly random: () => number = Math.random,
  ) {
    this.ceiling = policy.BaseMs;
  }

  authenticated(now = Date.now()) {
    this.authenticatedAt = now;
  }

  next(now = Date.now()) {
    if (this.authenticatedAt !== undefined && now - this.authenticatedAt >= this.policy.StableMs) {
      this.reset();
    }

    this.authenticatedAt = undefined;
    const delay = Math.floor(this.ceiling / 2 + (this.random() * this.ceiling) / 2);

    this.ceiling = Math.min(this.policy.MaxMs, this.ceiling * 2);

    return delay;
  }

  reset() {
    this.ceiling = this.policy.BaseMs;
    this.authenticatedAt = undefined;
  }
}
