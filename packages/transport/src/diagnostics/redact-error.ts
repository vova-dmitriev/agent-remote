/** A message made only of a code, such as `QUEUE_CLOSE_FAILED`, carries no user data. */
const CODE_MESSAGE = /^[A-Z][A-Z0-9_]*$/;
/** An `error.code` safe to log: an application or Node code, or a PostgreSQL SQLSTATE. */
const SAFE_CODE = /^[A-Z0-9_]{2,40}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const STACK_FRAME = /^\s+at /;

export interface RedactedError {
  /** `Name: CODE` when the message is a code, else the name; `typeof` for a thrown non-Error. */
  message: string;
  /** `error.code` when it is a safe code. */
  code?: string;
  /** Only the `at …` frames: the stack header repeats the message. */
  stack?: string;
}

/**
 * What an error may put in a log. Messages, the stack header and unknown codes are dropped, so tokens, init data,
 * cookies, chat or file content and URLs in them never reach a log.
 */
export function redactError(error: unknown): RedactedError {
  if (!(error instanceof Error)) {
    return { message: typeof error };
  }

  // A query builder keeps the driver's error (and its SQLSTATE) as `cause`.
  const code = (error as { code?: unknown }).code ?? (error.cause as { code?: unknown } | undefined)?.code;

  const stack = error.stack
    ?.split('\n')
    .filter((line) => STACK_FRAME.test(line))
    .join('\n');

  return {
    message: CODE_MESSAGE.test(error.message) ? `${error.name}: ${error.message}` : error.name,
    ...(typeof code === 'string' && (SAFE_CODE.test(code) || SQLSTATE.test(code)) ? { code } : {}),
    ...(stack ? { stack } : {}),
  };
}
