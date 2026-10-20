/** Reconnect delays: the ceiling doubles from `BaseMs` per failed attempt up to `MaxMs`; each delay is uniform below it. */
export const RECONNECT_BACKOFF = { BaseMs: 1_500, MaxMs: 30_000 } as const

/**
 * Capped exponential backoff with full jitter, so clients a relay closed at the same moment do not retry in step.
 * `reset` after a successful authentication starts again from `BaseMs`.
 */
export class ReconnectBackoff {
  private ceiling: number = RECONNECT_BACKOFF.BaseMs

  constructor(private readonly random: () => number = Math.random) {}

  next() {
    const delay = Math.floor(this.random() * this.ceiling)

    this.ceiling = Math.min(RECONNECT_BACKOFF.MaxMs, this.ceiling * 2)

    return delay
  }

  reset() {
    this.ceiling = RECONNECT_BACKOFF.BaseMs
  }
}
