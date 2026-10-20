import { expect, it } from 'vitest';
import { localActionSchema, localRequestSchema } from '@protocol';

it('accepts typed history and commands while rejecting caller-supplied authority and arbitrary URLs', () => {
  const request = {
    kind: 'request',
    version: 1,
    requestId: 'request-1',
    lease: 'lease-1',
    action: { operation: 'history', sessionId: 'session-1', generation: 'generation-1', direction: 'latest' },
  };

  expect(localRequestSchema.safeParse(request).success).toBe(true);
  expect(localRequestSchema.safeParse({ ...request, ownerId: 'other-owner' }).success).toBe(false);
  expect(localRequestSchema.safeParse({ ...request, version: 2 }).success).toBe(false);

  expect(localActionSchema.safeParse({ operation: 'request', url: 'file:///private/file' }).success).toBe(
    false,
  );

  expect(localActionSchema.safeParse({ ...request.action, cwd: '/arbitrary' }).success).toBe(false);
});

it('rejects unbounded media input before it reaches a privileged service', () => {
  expect(
    localActionSchema.safeParse({
      operation: 'media_chunk',
      transferId: 'transfer-1',
      offset: -1,
      data: 'YQ==',
    }).success,
  ).toBe(false);

  expect(
    localActionSchema.safeParse({
      operation: 'media_chunk',
      transferId: 'transfer-1',
      offset: 0,
      data: 'x'.repeat(400000),
    }).success,
  ).toBe(false);

  expect(
    localActionSchema.safeParse({
      operation: 'media_read',
      sessionId: 'session-1',
      attachmentId: '../../private',
    }).success,
  ).toBe(false);
});
