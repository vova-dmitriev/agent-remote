import { Logger } from '@nestjs/common';
import { ErrorCode } from '@protocol';
import { redactError } from '@transport/diagnostics/redact-error.js';
import { Fault } from './fault.js';

const FAULT_CONTEXT = 'FaultFilter';

/** `[what failed] Name[: CODE] [code=error.code]`: only codes and names, never an error's free text. */
function logMessage(error: unknown, failure?: string) {
  const { message, code, stack } = redactError(error);

  return { message: [failure, message, code && `code=${code}`].filter(Boolean).join(' '), stack };
}

/** Logs an error the relay did not expect, with its stack frames; `failure` names what failed. */
export function logError(context: string, error: unknown, failure?: string) {
  const { message, stack } = logMessage(error, failure);

  Logger.error(message, stack, context);
}

/** Logs a failure the relay recovers from, without its stack; `failure` names what failed. */
export function logWarning(context: string, error: unknown, failure?: string) {
  Logger.warn(logMessage(error, failure).message, context);
}

/**
 * Logs the error behind an internal fault, which the client sees only as `INTERNAL_ERROR`; returns the fault.
 * Faults and validation errors are the client's and are not logged.
 */
export function reportFault(error: unknown, fault: Fault, context = FAULT_CONTEXT): Fault {
  if (!(error instanceof Fault) && fault.code === ErrorCode.INTERNAL_ERROR) {
    logError(context, error);
  }

  return fault;
}
