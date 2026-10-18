import { ErrorCode, LOCAL_AUTH_ERROR_CODES } from '../../../../../packages/protocol/src/index.js';

export const RECONNECT_DELAYS_MS = [1000, 2000, 4000] as const;
export const TERMINAL_AUTH_ERRORS = new Set<string>(LOCAL_AUTH_ERROR_CODES);
export const TERMINAL_CONNECTION_ERRORS = new Set<string>([
  ...TERMINAL_AUTH_ERRORS,
  ErrorCode.LOCAL_VERSION_MISMATCH,
  ErrorCode.LOCAL_COMPANION_MISMATCH,
  ErrorCode.INVALID_FRAME,
]);
