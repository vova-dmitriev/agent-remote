import { ErrorCode } from '@protocol';

export const AttachmentErrorCode = {
  Unavailable: ErrorCode.ATTACHMENT_UNAVAILABLE,
  Quota: ErrorCode.ATTACHMENT_QUOTA,
  IntegrityFailed: ErrorCode.ATTACHMENT_INTEGRITY_FAILED,
  TransferFailed: ErrorCode.ATTACHMENT_TRANSFER_FAILED,
  RateLimited: ErrorCode.ATTACHMENT_RATE_LIMITED,
  SourceUnavailable: ErrorCode.ATTACHMENT_SOURCE_UNAVAILABLE,
  TooLarge: ErrorCode.ATTACHMENT_TOO_LARGE,
} as const;

export type AttachmentErrorCode = (typeof AttachmentErrorCode)[keyof typeof AttachmentErrorCode];
export const RETRYABLE_ATTACHMENT_ERRORS: ReadonlySet<string> = new Set([
  AttachmentErrorCode.Unavailable,
  AttachmentErrorCode.TransferFailed,
  AttachmentErrorCode.RateLimited,
]);
export const ATTACHMENT_VALIDATION_ERRORS: ReadonlySet<string> = new Set([
  AttachmentErrorCode.TooLarge,
  AttachmentErrorCode.IntegrityFailed,
]);
