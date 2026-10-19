import { describe, expect, it } from 'vitest';
import { ContinuityLocalRequestKind, FrameType, serverFrameSchema, deviceFrameSchema } from '@protocol';

describe('continuity local request frames', () => {
  it('correlates local inspect replies to a server request and rejects extra fields', () => {
    const request = {
      type: FrameType.ContinuityRequest,
      requestId: '11111111-1111-4111-8111-111111111111',
      epoch: 'epoch-1',
      request: {
        kind: ContinuityLocalRequestKind.InspectSource,
        sessionId: 'session-1',
        generation: 'generation-1',
      },
    };

    const reply = {
      type: FrameType.ContinuityResult,
      requestId: request.requestId,
      epoch: request.epoch,
      reply: {
        ok: true,
        response: {
          kind: ContinuityLocalRequestKind.InspectSource,
          data: {
            supported: false,
            reason: 'unknown_profile',
            sessionId: 'session-1',
            generation: 'generation-1',
          },
        },
      },
    };

    expect(serverFrameSchema.parse(request)).toEqual(request);
    expect(deviceFrameSchema.parse(reply)).toEqual(reply);
    expect(() => deviceFrameSchema.parse({ ...reply, checkpointText: 'private' })).toThrow();
  });
});
