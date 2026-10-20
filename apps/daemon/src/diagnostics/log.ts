import { redactError } from '@transport/diagnostics/redact-error.js';

/** Debug output is off unless the companion runs with `REMOTE_DEBUG=1`. */
const DEBUG_VARIABLE = 'REMOTE_DEBUG';
const DEBUG_ENABLED = '1';

const debugEnabled = () => process.env[DEBUG_VARIABLE] === DEBUG_ENABLED;

/**
 * Writes one JSON line describing a failure the companion recovers from, to stderr and only in debug mode.
 * The error is redacted: its name, a code-like message or code, and its stack frames, never its free text.
 */
export function logDebug(scope: string, error: unknown): void {
  if (debugEnabled()) {
    process.stderr.write(JSON.stringify({ scope, ...redactError(error) }) + '\n');
  }
}

/** Writes one JSON line counting what a pass skipped, such as malformed records in one page, in debug mode. */
export function logDebugCount(scope: string, skipped: string, count: number): void {
  if (debugEnabled() && count > 0) {
    process.stderr.write(JSON.stringify({ scope, skipped, count }) + '\n');
  }
}
