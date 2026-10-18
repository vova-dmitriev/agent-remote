import { ErrorCode } from '../../../../../../packages/protocol/src/index.js';

export class ProfileProcessCleanupError extends Error {
  constructor() {
    super(ErrorCode.REQUEST_TIMEOUT);
  }
}
