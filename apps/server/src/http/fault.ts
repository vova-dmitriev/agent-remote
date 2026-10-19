import type { HttpStatus } from '@protocol';
import { faultStatus, type FaultCode } from './fault-status.js';

export class Fault extends Error {
  constructor(
    readonly code: FaultCode,
    readonly status: HttpStatus = faultStatus(code),
  ) {
    super(code);
  }
}
