import { ErrorCode, type HttpStatus } from '@protocol';
import { z } from 'zod';
import { faultStatus, type FaultCode } from './fault-status.js';

export class Fault extends Error {
  constructor(
    readonly code: FaultCode,
    readonly status: HttpStatus = faultStatus(code),
  ) {
    super(code);
  }
}

/** Parses JSON a client sent; text that is not JSON is the client's invalid frame, never an internal error. */
export const parseClientJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new Fault(ErrorCode.INVALID_FRAME);
  }
};

/** Maps any thrown value to the fault reported to a client: validation errors are invalid requests, the rest internal. */
export const toFault = (error: unknown): Fault => {
  if (error instanceof Fault) {
    return error;
  }

  if (error instanceof z.ZodError) {
    return new Fault(ErrorCode.INVALID_REQUEST);
  }

  return new Fault(ErrorCode.INTERNAL_ERROR);
};
