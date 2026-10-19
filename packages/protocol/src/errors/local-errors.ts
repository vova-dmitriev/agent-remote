import { ErrorCode } from './error-codes.js';

export const LOCAL_AUTH_ERROR_CODES = [
  ErrorCode.LOCAL_GRANT_REVOKED,
  ErrorCode.UNAUTHORIZED,
  ErrorCode.REVOKED,
  ErrorCode.LOCAL_APPROVAL_REQUIRED,
  ErrorCode.TOKEN_EXPIRED,
  ErrorCode.NO_AUTHENTICATED_CLIENT,
] as const;
