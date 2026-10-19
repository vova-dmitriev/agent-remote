import { describe, expect, it } from 'vitest';
import { startHandoffRequestSchema } from '@protocol';

const request = {
  ownerId: '11111111-1111-4111-8111-111111111111',
  deviceId: '22222222-2222-4222-8222-222222222222',
  conversationId: '33333333-3333-4333-8333-333333333333',
  expectedConversationVersion: 1,
  sourceExecutionId: '44444444-4444-4444-8444-444444444444',
  sourceGeneration: '55555555-5555-4555-8555-555555555555',
  checkpointId: '66666666-6666-4666-8666-666666666666',
  checkpointDigest: 'a'.repeat(64),
  expectedProfileVersion: 1,
  selection: {
    provider: 'codex',
    profileId: '77777777-7777-4777-8777-777777777777',
    model: 'gpt-test',
  },
};

describe('idempotent handoff start request', () => {
  it('accepts a stable caller operation key and strict request envelope', () => {
    expect(
      startHandoffRequestSchema.parse({
        operationId: '88888888-8888-4888-8888-888888888888',
        request,
      }),
    ).toMatchObject({ request });
  });

  it('rejects caller-minted command ids and private payload fields', () => {
    const input = {
      operationId: '88888888-8888-4888-8888-888888888888',
      request,
      createCommandId: '99999999-9999-4999-8999-999999999999',
    };

    expect(startHandoffRequestSchema.safeParse(input).success).toBe(false);

    expect(
      startHandoffRequestSchema.safeParse({ operationId: input.operationId, request, body: 'secret' })
        .success,
    ).toBe(false);
  });
});
