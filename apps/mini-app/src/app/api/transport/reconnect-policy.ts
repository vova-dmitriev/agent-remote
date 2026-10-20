import { ReconnectBackoff, type ReconnectBackoffPolicy } from "@transport/reconnect-backoff"

/**
 * The Mini App's relay reconnect timing. Its base is above the companion's 1 s: many browser clients share one relay,
 * and a human-facing view gains little from a sub-second first retry.
 */
export const RECONNECT_BACKOFF = { BaseMs: 1_500, MaxMs: 30_000, StableMs: 10_000 } as const satisfies ReconnectBackoffPolicy

export const appReconnectBackoff = () => new ReconnectBackoff(RECONNECT_BACKOFF)
