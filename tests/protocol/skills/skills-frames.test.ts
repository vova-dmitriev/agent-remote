import { expect, it } from 'vitest';
import { deviceFrameSchema, FrameType, serverFrameSchema } from '@protocol';

const requestId = '00000000-0000-4000-8000-000000000001';

it('carries only correlated owned-session skill metadata over the device channel', () => {
  expect(
    serverFrameSchema.safeParse({
      type: FrameType.SkillsRequest,
      requestId,
      sessionId: 'session',
      generation: 'generation',
    }).success,
  ).toBe(true);

  const result = {
    type: FrameType.SkillsResult,
    requestId,
    reply: {
      ok: true,
      skills: {
        sessionId: 'session',
        generation: 'generation',
        supported: true,
        truncated: false,
        skills: [{ name: 'review', invocation: '/review', description: 'Review changes' }],
      },
    },
  };

  expect(deviceFrameSchema.safeParse(result).success).toBe(true);
  expect(deviceFrameSchema.safeParse({ ...result, body: 'private skill instructions' }).success).toBe(false);

  expect(
    serverFrameSchema.safeParse({
      type: FrameType.SkillsRequest,
      requestId,
      sessionId: 'session',
      generation: 'generation',
      path: '/private',
    }).success,
  ).toBe(false);
});
