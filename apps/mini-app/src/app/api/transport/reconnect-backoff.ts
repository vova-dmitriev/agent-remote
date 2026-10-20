/**
 * Reconnect delays: the ceiling doubles from `BaseMs` per failed attempt up to `MaxMs`; each delay lies between half
 * the ceiling and the ceiling. A connection counts as recovered only after it stayed authenticated for `StableMs`.
 */
export const RECONNECT_BACKOFF = { BaseMs: 1_500, MaxMs: 30_000, StableMs: 10_000 } as const

/**
 * Capped exponential backoff with equal jitter, as the companion's relay client uses: clients that a relay closed at
 * the same moment spread out, and none retries sooner than half the ceiling. A connection that authenticates and
 * drops again within `StableMs` keeps backing off instead of looping at the base delay.
 */
export class ReconnectBackoff {
  private ceiling: number = RECONNECT_BACKOFF.BaseMs
  private authenticatedAt: number | undefined

  constructor(private readonly random: () => number = Math.random) {}

  authenticated(now = Date.now()) {
    this.authenticatedAt = now
  }

  next(now = Date.now()) {
    if (this.authenticatedAt !== undefined && now - this.authenticatedAt >= RECONNECT_BACKOFF.StableMs) {
      this.reset()
    }

    this.authenticatedAt = undefined
    const delay = Math.floor(this.ceiling / 2 + (this.random() * this.ceiling) / 2)

    this.ceiling = Math.min(RECONNECT_BACKOFF.MaxMs, this.ceiling * 2)

    return delay
  }

  reset() {
    this.ceiling = RECONNECT_BACKOFF.BaseMs
    this.authenticatedAt = undefined
  }
}
