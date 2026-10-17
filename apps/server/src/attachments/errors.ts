import { ErrorCode } from '../../../../packages/protocol/src/index.js';

export const AttachmentFaultCode = {
  Invalid: ErrorCode.INVALID_ATTACHMENT,
  TooLarge: ErrorCode.ATTACHMENT_TOO_LARGE,
  IdReused: ErrorCode.ATTACHMENT_ID_REUSED,
  Expired: ErrorCode.ATTACHMENT_EXPIRED,
  Mismatch: ErrorCode.ATTACHMENT_MISMATCH,
  RebuildRequired: ErrorCode.ATTACHMENT_REBUILD_REQUIRED,
  Quota: ErrorCode.ATTACHMENT_QUOTA,
  UploadBusy: ErrorCode.UPLOAD_BUSY,
  UploadTimeout: ErrorCode.UPLOAD_TIMEOUT,
} as const;

export type AttachmentFaultCode = (typeof AttachmentFaultCode)[keyof typeof AttachmentFaultCode];
