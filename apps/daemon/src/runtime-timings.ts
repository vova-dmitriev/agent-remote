import type { ReconnectBackoffPolicy } from '@transport/reconnect-backoff.js';

export const SOURCE_POLL_INTERVAL_MS = 1000;
export const SESSION_ACTIVITY_POLL_INTERVAL_MS = 1000;
export const NATIVE_PROCESS_POLL_INTERVAL_MS = 5000;
export const ATTACHMENT_RETRY_INTERVAL_MS = 30_000;
/** After a relay rejects the protocol version, the companion probes it again this often instead of retrying. */
export const PROTOCOL_REPROBE_MS = 600_000;
/**
 * The companion's relay reconnect timing. Its 1 s base is below the Mini App's: one companion per device reconnects,
 * and it should resume its live session as soon as a restarted relay accepts it.
 */
export const RELAY_RECONNECT_BACKOFF = {
  BaseMs: 1_000,
  MaxMs: 30_000,
  StableMs: 10_000,
} as const satisfies ReconnectBackoffPolicy;
