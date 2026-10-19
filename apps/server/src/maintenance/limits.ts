/** How often the relay checks live connections without touching storage. */
export const MAINTENANCE_TICK_MS = 1_000;
/** A device socket silent for this long is closed and the device goes offline. */
export const DEVICE_SILENCE_MS = 30_000;
/** How often every open app socket's token is checked against PostgreSQL, to catch revocations made elsewhere. */
export const AUTH_RECHECK_MS = 30_000;

/** How often retention runs: once per interval across all relays when Redis is configured, else per process. */
export const RETENTION_INTERVAL_MS = 60_000;
/** Rows one retention delete removes before it runs again. */
export const RETENTION_BATCH = 5_000;
/** Events older than this are dropped. */
export const EVENT_RETENTION_MS = 86_400_000;
/** Each device keeps at most this many of its newest events. */
export const EVENTS_PER_DEVICE = 10_000;
/** A command the device has not acknowledged by then is marked unknown. */
export const COMMAND_ACK_TIMEOUT_MS = 15_000;
/** Command audit rows older than this are dropped. */
export const COMMAND_AUDIT_RETENTION_MS = 86_400_000;

/** The BullMQ queue and its single job scheduler id: one id, so one relay runs each retention pass. */
export const RETENTION_QUEUE = 'retention';
export const RETENTION_JOB_ID = 'retention';
