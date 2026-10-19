import { ErrorCode, HttpStatus } from '@protocol';
import { describe, expect, it } from 'vitest';
import { AttachmentFaultCode } from '../apps/server/src/attachments/errors.js';
import { ContinuityError } from '../apps/server/src/continuity/types.js';
import { Fault } from '../apps/server/src/http/fault.js';

describe('Fault status', () => {
  it.each([
    [ErrorCode.UNAUTHORIZED, 401],
    [ErrorCode.NOT_FOUND, 404],
    [ErrorCode.PROFILE_NOT_READY, 409],
    [ErrorCode.RATE_LIMITED, 429],
    [ErrorCode.INTERNAL_ERROR, 503],
    [ErrorCode.INVALID_REQUEST, 400],
    [AttachmentFaultCode.Expired, 410],
    [AttachmentFaultCode.TooLarge, 413],
    [AttachmentFaultCode.UploadTimeout, 408],
    [ContinuityError.NotFound, 404],
    [ContinuityError.VersionConflict, 409],
    [ErrorCode.INVALID_CURSOR, 400],
  ])('%s -> %i', (code, status) => {
    expect(new Fault(code).status).toBe(status);
  });

  it('keeps an explicit override', () => {
    expect(new Fault(ContinuityError.InvalidPhase, HttpStatus.BadRequest).status).toBe(400);
  });
});
