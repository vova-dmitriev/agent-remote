/** Debug output is off unless the companion runs with `REMOTE_DEBUG=1`. */
const DEBUG_VARIABLE = 'REMOTE_DEBUG';
const DEBUG_ENABLED = '1';

/** A message made only of a code, such as `SOURCE_UNAVAILABLE`, carries no user data. */
const CODE_MESSAGE = /^[A-Z][A-Z0-9_]*$/;
const STACK_FRAME = /^\s+at /;

/**
 * Writes one JSON line describing a failure the companion recovers from, to stderr and only in debug mode.
 * It keeps the error's name, its message only when that is a code, and its stack frames: the stack's header repeats
 * the message, which may hold tokens, paths, prompts or file contents.
 */
export function logDebug(scope: string, error: unknown): void {
  if (process.env[DEBUG_VARIABLE] !== DEBUG_ENABLED) {
    return;
  }

  const entry =
    error instanceof Error
      ? {
          scope,
          name: error.name,
          ...(CODE_MESSAGE.test(error.message) ? { code: error.message } : {}),
          stack: error.stack
            ?.split('\n')
            .filter((line) => STACK_FRAME.test(line))
            .join('\n'),
        }
      : { scope, name: typeof error };

  process.stderr.write(JSON.stringify(entry) + '\n');
}
