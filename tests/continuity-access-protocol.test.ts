import { describe, expect, it } from 'vitest';
import {
  ContinuityLocalRequestKind,
  continuityLocalRequestSchema,
  continuityLocalResponseSchema,
} from '../packages/protocol/src/index.js';

const ids = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  generation: '22222222-2222-4222-8222-222222222222',
  conversationId: '33333333-3333-4333-8333-333333333333',
  executionId: '44444444-4444-4444-8444-444444444444',
};

describe('device-local continuity contract', () => {
  it('strictly parses inspect and checkpoint preparation requests', () => {
    expect(
      continuityLocalRequestSchema.parse({
        kind: ContinuityLocalRequestKind.InspectSource,
        sessionId: ids.sessionId,
        generation: ids.generation,
      }),
    ).toMatchObject({ kind: ContinuityLocalRequestKind.InspectSource });

    expect(
      continuityLocalRequestSchema.parse({
        kind: ContinuityLocalRequestKind.PrepareCheckpoint,
        conversationId: ids.conversationId,
        executionId: ids.executionId,
        expectedConversationVersion: 1,
        selection: { selectedMessageIds: [], selectedAttachmentIds: [], constraints: [] },
      }),
    ).toMatchObject({ kind: ContinuityLocalRequestKind.PrepareCheckpoint });
  });

  it('returns preview text without allowing it in server metadata shapes', () => {
    const response = {
      kind: ContinuityLocalRequestKind.PrepareCheckpoint,
      data: {
        draft: {
          id: ids.executionId,
          digest: 'a'.repeat(64),
          approved: false,
          sourceExecutionId: ids.executionId,
          sourceGeneration: ids.generation,
          historyWatermark: 'codex:stream:3',
          coverage: 'complete',
          messageCount: 1,
          attachmentCount: 0,
          estimatedTokens: 2,
          missingMessageIds: [],
          textTruncated: false,
          byteCount: 8,
        },
        previewText: 'review this visible context',
      },
    };

    expect(continuityLocalResponseSchema.parse(response)).toEqual(response);

    expect(
      continuityLocalRequestSchema.safeParse({
        kind: ContinuityLocalRequestKind.InspectSource,
        sessionId: ids.sessionId,
        generation: ids.generation,
        previewText: 'not a request field',
      }).success,
    ).toBe(false);
  });
});
