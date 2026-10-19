import { describe, expect, it } from 'vitest';
import { appFrameSchema, deviceFrameSchema, FrameType } from '@protocol';

const proof = {
  type: FrameType.HandoffSeedProof,
  operationId: '11111111-1111-4111-8111-111111111111',
  seedCommandId: '22222222-2222-4222-8222-222222222222',
  checkpointId: '33333333-3333-4333-8333-333333333333',
  checkpointDigest: 'a'.repeat(64),
  targetExecutionId: '44444444-4444-4444-8444-444444444444',
  targetGeneration: '55555555-5555-4555-8555-555555555555',
  selection: {
    provider: 'claude',
    profileId: '66666666-6666-4666-8666-666666666666',
    model: 'claude-model',
    effort: 'high',
  },
};

describe('authenticated handoff proof frame contract', () => {
  it('accepts the metadata-only proof only on device frames', () => {
    expect(deviceFrameSchema.parse(proof)).toEqual(proof);
    expect(appFrameSchema.safeParse(proof).success).toBe(false);
  });

  it('rejects principal or private payload fields', () => {
    expect(deviceFrameSchema.safeParse({ ...proof, ownerId: 'forged' }).success).toBe(false);
    expect(deviceFrameSchema.safeParse({ ...proof, summary: 'private text' }).success).toBe(false);
  });
});
