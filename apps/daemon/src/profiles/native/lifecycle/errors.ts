import { ErrorCode } from '@protocol';

export class ProfileProcessCleanupError extends Error {
  constructor() {
    super(ErrorCode.REQUEST_TIMEOUT);
  }
}
