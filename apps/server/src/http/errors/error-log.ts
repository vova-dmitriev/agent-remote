import { Logger } from '@nestjs/common';
import { ErrorCode } from '@protocol';
import { Fault } from './fault.js';

/** A message made only of a code, such as `QUEUE_CLOSE_FAILED`, carries no user data. */
const CODE_MESSAGE = /^[A-Z][A-Z0-9_]*$/;
const STACK_FRAME = /^\s+at /;
const FAULT_CONTEXT = 'FaultFilter';

export interface ErrorDescription {
  message: string;
  stack: string | undefined;
}

/**
 * What an error may put in a log: its name, its message only when that is a code, and its stack frames.
 * The stack's header repeats the message, so only the `at …` frames are kept. Tokens, init data, cookies,
 * chat content and URLs in a message never reach the log.
 */
export function describeError(error: unknown): ErrorDescription {
  if (!(error instanceof Error)) {
    return { message: typeof error, stack: undefined };
  }

  return {
    message: CODE_MESSAGE.test(error.message) ? `${error.name}: ${error.message}` : error.name,
    stack: error.stack
      ?.split('\n')
      .filter((line) => STACK_FRAME.test(line))
      .join('\n'),
  };
}

/** Logs an error the relay did not expect, with its stack. */
export function logError(context: string, error: unknown) {
  const { message, stack } = describeError(error);

  Logger.error(message, stack, context);
}

/** Logs the error behind an internal fault, which the client sees only as `INTERNAL_ERROR`; returns the fault. */
export function reportFault(error: unknown, fault: Fault): Fault {
  if (!(error instanceof Fault) && fault.code === ErrorCode.INTERNAL_ERROR) {
    logError(FAULT_CONTEXT, error);
  }

  return fault;
}

/** Logs a failure the relay recovers from, without its stack; `code` names what failed. */
export function logWarning(context: string, error: unknown, code?: string) {
  const { message } = describeError(error);

  Logger.warn(code ? `${code} ${message}` : message, context);
}
