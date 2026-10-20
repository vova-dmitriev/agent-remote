import { describe, expect, it } from 'vitest';
import {
  FrameType,
  handoffSeedAdmissionFrameSchema,
  handoffSeedIntentFrameSchema,
  executionLaunchSelectionSchema,
} from '@protocol';

const seedMeta = {
  operationId: '11111111-1111-4111-8111-111111111111',
  seedCommandId: '22222222-2222-4222-8222-222222222222',
  checkpointId: '33333333-3333-4333-8333-333333333333',
  checkpointDigest: 'a'.repeat(64),
  targetExecutionId: '44444444-4444-4444-8444-444444444444',
  targetGeneration: '55555555-5555-4555-8555-555555555555',
  selection: { provider: 'codex', profileId: '66666666-6666-4666-8666-666666666666', model: 'gpt-test' },
};

describe('handoff seed intent protocol', () => {
  it('correlates admission to exact operation, seed command, target, and selection without checkpoint text', () => {
    expect(
      handoffSeedIntentFrameSchema.parse({ type: FrameType.HandoffSeedIntent, ...seedMeta }),
    ).toMatchObject({ type: FrameType.HandoffSeedIntent, seedCommandId: seedMeta.seedCommandId });

    expect(
      handoffSeedAdmissionFrameSchema.parse({ type: FrameType.HandoffSeedAdmitted, ...seedMeta }),
    ).toMatchObject({ type: FrameType.HandoffSeedAdmitted, targetGeneration: seedMeta.targetGeneration });

    expect(() =>
      handoffSeedIntentFrameSchema.parse({
        type: FrameType.HandoffSeedIntent,
        ...seedMeta,
        text: 'private checkpoint',
      }),
    ).toThrow();

    expect(() =>
      handoffSeedAdmissionFrameSchema.parse({
        type: FrameType.HandoffSeedAdmitted,
        ...seedMeta,
        body: 'private checkpoint',
      }),
    ).toThrow();

    expect(executionLaunchSelectionSchema.parse(seedMeta.selection)).toEqual(seedMeta.selection);
  });
});
