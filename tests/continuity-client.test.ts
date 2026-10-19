import { describe, expect, it } from 'vitest';
import {
  AgentProvider,
  ContinuityCompatibilityReason,
  ContinuityLocalRequestKind,
  ErrorCode,
  HandoffPhase,
} from '../packages/protocol/src/index.js';
import { BoundContinuityClient } from '../packages/transport/src/continuity-client.js';

const source = { deviceId: 'device:a', sessionId: 'session:b', generation: 'generation' };

const inspection = {
  source: {
    supported: false,
    reason: ContinuityCompatibilityReason.UnknownProfile,
    sessionId: source.sessionId,
    generation: source.generation,
  },
  conversation: null,
  sourceExecution: null,
  pendingHandoff: null,
};

describe('bound continuity client', () => {
  it('encodes native IDs and validates the inspected source instead of accepting a different session', async () => {
    const seen: unknown[] = [];
    let response = inspection;

    const client = new BoundContinuityClient(source.deviceId, async (method, path, body) => {
      seen.push({ method, path, body });

      return response;
    });

    await expect(client.inspect(source)).resolves.toEqual(inspection);

    expect(seen).toEqual([
      { method: 'POST', path: '/devices/device%3Aa/continuity/sessions/session%3Ab/inspect', body: source },
    ]);

    response = { ...inspection, source: { ...inspection.source, sessionId: 'foreign' } };
    await expect(client.inspect(source)).rejects.toThrow(ErrorCode.INVALID_FRAME);
  });

  it('rejects foreign devices before exchange and rejects a response after the client lease expires', async () => {
    let current = true;
    let exchanged = false;

    const client = new BoundContinuityClient(
      source.deviceId,
      async () => {
        exchanged = true;
        current = false;

        return inspection;
      },
      () => current,
    );

    await expect(client.inspect({ ...source, deviceId: 'foreign' })).rejects.toThrow(ErrorCode.ACCESS_DENIED);
    expect(exchanged).toBe(false);
    await expect(client.inspect(source)).rejects.toThrow(ErrorCode.STALE_EPOCH);
  });

  it('retains the caller operation ID and rejects substituted handoff selection or operation', async () => {
    const input = {
      operationId: '00000000-0000-4000-8000-000000000001',
      request: {
        ownerId: 'owner',
        deviceId: source.deviceId,
        conversationId: 'conversation',
        expectedConversationVersion: 1,
        sourceExecutionId: 'execution',
        sourceGeneration: source.generation,
        checkpointId: 'checkpoint',
        checkpointDigest: 'a'.repeat(64),
        expectedProfileVersion: 1,
        selection: {
          profileId: '00000000-0000-4000-8000-000000000002',
          provider: AgentProvider.Codex,
          model: 'model',
        },
      },
    };

    const operation = {
      ...input.request,
      id: input.operationId,
      phase: HandoffPhase.CreatingTarget,
      targetExecutionId: null,
      createCommandId: 'create',
      seedCommandId: 'seed',
      updatedAt: 1,
    };

    let response = operation;
    const sent: unknown[] = [];

    const client = new BoundContinuityClient(source.deviceId, async (method, path, body) => {
      sent.push({ method, path, body });

      return response;
    });

    await expect(client.startHandoff(input)).resolves.toEqual(operation);
    expect(sent[0]).toEqual({ method: 'POST', path: '/continuity/handoffs', body: input });
    response = { ...operation, selection: { ...operation.selection, model: 'another-model' } };
    await expect(client.startHandoff(input)).rejects.toThrow(ErrorCode.INVALID_FRAME);
    response = { ...operation, id: '00000000-0000-4000-8000-000000000003' };

    await expect(
      client.getHandoff({ deviceId: source.deviceId, operationId: input.operationId }),
    ).rejects.toThrow(ErrorCode.INVALID_FRAME);
  });

  it('does not accept an inspection response in place of checkpoint preparation or approval', async () => {
    const client = new BoundContinuityClient(source.deviceId, async () => ({
      kind: ContinuityLocalRequestKind.InspectSource,
      data: inspection.source,
    }));

    await expect(
      client.prepareCheckpoint({
        kind: ContinuityLocalRequestKind.PrepareCheckpoint,
        deviceId: source.deviceId,
        conversationId: 'conversation',
        executionId: 'execution',
        expectedConversationVersion: 1,
        selection: { selectedMessageIds: [], selectedAttachmentIds: [], constraints: [] },
      }),
    ).rejects.toThrow(ErrorCode.INVALID_FRAME);

    await expect(
      client.approveCheckpoint({
        ...source,
        kind: ContinuityLocalRequestKind.ApproveCheckpoint,
        checkpointId: 'checkpoint',
        expectedDraftDigest: 'a'.repeat(64),
        editedSummary: 'Approved summary',
      }),
    ).rejects.toThrow(ErrorCode.INVALID_FRAME);
  });
});
