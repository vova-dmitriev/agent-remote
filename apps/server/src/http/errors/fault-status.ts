import { ErrorCode, HttpStatus } from '@protocol';
import { AttachmentFaultCode } from '../../attachments/errors.js';
import { ContinuityError } from '../../continuity/types.js';
import type { ServerErrorCode } from '../../error-codes.js';

export type FaultCode = ErrorCode | ServerErrorCode | AttachmentFaultCode | ContinuityError;

const continuityConflicts = Object.fromEntries(
  Object.values(ContinuityError)
    .filter((code) => code !== ContinuityError.NotFound)
    .map((code) => [code, HttpStatus.Conflict]),
);

const statusByCode = {
  ...continuityConflicts,
  [ErrorCode.UNAUTHORIZED]: HttpStatus.Unauthorized,
  [ErrorCode.ACCESS_DENIED]: HttpStatus.Forbidden,
  [ErrorCode.NOT_FOUND]: HttpStatus.NotFound,
  [ContinuityError.NotFound]: HttpStatus.NotFound,
  [AttachmentFaultCode.UploadTimeout]: HttpStatus.RequestTimeout,
  [ErrorCode.CAPABILITY_UNAVAILABLE]: HttpStatus.Conflict,
  [ErrorCode.COMMAND_ID_REUSED]: HttpStatus.Conflict,
  [ErrorCode.DEVICE_OFFLINE]: HttpStatus.Conflict,
  [ErrorCode.DEVICE_QUOTA]: HttpStatus.Conflict,
  [ErrorCode.INVALID_DEVICE]: HttpStatus.Conflict,
  [ErrorCode.INVALID_FRAME]: HttpStatus.Conflict,
  [ErrorCode.LOCAL_REVISION_CONFLICT]: HttpStatus.Conflict,
  [ErrorCode.PAIRING_UNAVAILABLE]: HttpStatus.Conflict,
  [ErrorCode.PERMISSION_EXPIRED]: HttpStatus.Conflict,
  [ErrorCode.PROFILE_NOT_READY]: HttpStatus.Conflict,
  [ErrorCode.REQUEST_FAILED]: HttpStatus.Conflict,
  [ErrorCode.SESSION_NOT_IDLE]: HttpStatus.Conflict,
  [ErrorCode.STALE_EPOCH]: HttpStatus.Conflict,
  [ErrorCode.STALE_SESSION]: HttpStatus.Conflict,
  [ErrorCode.USER_INPUT_EXPIRED]: HttpStatus.Conflict,
  [AttachmentFaultCode.IdReused]: HttpStatus.Conflict,
  [AttachmentFaultCode.Mismatch]: HttpStatus.Conflict,
  [AttachmentFaultCode.Expired]: HttpStatus.Gone,
  [AttachmentFaultCode.TooLarge]: HttpStatus.PayloadTooLarge,
  [AttachmentFaultCode.Quota]: HttpStatus.PayloadTooLarge,
  [ErrorCode.RATE_LIMITED]: HttpStatus.TooManyRequests,
  [ErrorCode.QUEUE_FULL]: HttpStatus.TooManyRequests,
  [AttachmentFaultCode.UploadBusy]: HttpStatus.TooManyRequests,
  [ErrorCode.INTERNAL_ERROR]: HttpStatus.InternalServerError,
  [ErrorCode.SERVICE_UNAVAILABLE]: HttpStatus.ServiceUnavailable,
  [ErrorCode.ATTACHMENT_UNAVAILABLE]: HttpStatus.ServiceUnavailable,
  [ErrorCode.HISTORY_RELOAD_FAILED]: HttpStatus.ServiceUnavailable,
  [AttachmentFaultCode.RebuildRequired]: HttpStatus.ServiceUnavailable,
} satisfies Partial<Record<FaultCode, HttpStatus>>;

const statusLookup: Partial<Record<string, HttpStatus>> = statusByCode;

export const faultStatus = (code: FaultCode): HttpStatus => statusLookup[code] ?? HttpStatus.BadRequest;
