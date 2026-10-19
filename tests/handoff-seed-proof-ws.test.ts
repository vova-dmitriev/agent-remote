import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContinuityService } from '../apps/server/src/continuity/service.js';
import {
  rejectProofs,
  startHandoffProofFixture,
  waitFrame,
  type HandoffProofFixture,
} from './helpers/handoff-proof-fixture.js';
import { CommandActionType, CommandStatus, HttpStatus } from '@protocol';
import { dispatchAndCheckCreateEvidence } from './helpers/handoff-create-evidence.js';

let fixture: HandoffProofFixture;

beforeAll(async () => {
  fixture = await startHandoffProofFixture();
}, 30000);

afterAll(async () => fixture?.close());

describe('authenticated device seed proof', () => {
  it('binds proof to the handoff selection and activates only after device proof', async () => {
    const { relay, device, socket, principal } = fixture;
    const currentDevice = await relay.devices.owned(principal, device.deviceId);
    const scope = { deviceId: device.deviceId, deviceGeneration: currentDevice.generation };
    const service = new ContinuityService(relay.db, () => 20);
    const conversationId = randomUUID();

    const source = {
      conversationId,
      id: randomUUID(),
      provider: 'codex' as const,
      profileId: randomUUID(),
      mode: 'managed_cli' as const,
      nativeSessionId: randomUUID(),
      generation: randomUUID(),
    };

    await service.createConversation(principal, scope, source);

    const operation = await service.startHandoff(principal, scope, {
      operationId: randomUUID(),
      request: {
        ownerId: principal.userId,
        deviceId: device.deviceId,
        conversationId,
        expectedConversationVersion: 1,
        sourceExecutionId: source.id,
        sourceGeneration: source.generation,
        checkpointId: randomUUID(),
        checkpointDigest: 'c'.repeat(64),
        expectedProfileVersion: 1,
        selection: { provider: 'claude', profileId: randomUUID(), model: 'claude-test', effort: 'medium' },
      },
    });

    const evidence = await dispatchAndCheckCreateEvidence({
      relay,
      socket,
      principal,
      scope,
      service,
      operation,
      source,
    });

    const { nativeSessionId, targetExecutionId, targetGeneration, snapshot } = evidence;

    expect(evidence.codes).toEqual(Array(4).fill('CONTINUITY_TARGET_MISMATCH'));

    await service.recordCreatedTarget(principal, scope, operation.id, 1, {
      conversationId,
      id: targetExecutionId,
      provider: operation.selection.provider,
      profileId: operation.selection.profileId,
      mode: 'managed_cli',
      nativeSessionId,
      generation: targetGeneration,
    });

    await expect(service.getHandoff(principal, scope, operation.id)).resolves.toMatchObject({
      phase: 'delivering_context',
      seedCommandId: operation.seedCommandId,
      checkpointId: operation.checkpointId,
      checkpointDigest: operation.checkpointDigest,
      targetExecutionId,
      selection: operation.selection,
    });

    await expect(
      relay.command(principal, {
        commandId: operation.seedCommandId,
        target: snapshot.sessions[0]!.target,
        sessionId: nativeSessionId,
        generation: targetGeneration,
        action: { type: 'prompt', text: 'reserved command must not dispatch' },
      }),
    ).rejects.toMatchObject({ code: 'CONTINUITY_COMMAND_ID_RESERVED', status: HttpStatus.Conflict });

    const intent = {
      type: 'handoff_seed_intent',
      operationId: operation.id,
      seedCommandId: operation.seedCommandId,
      checkpointId: operation.checkpointId,
      checkpointDigest: operation.checkpointDigest,
      targetExecutionId,
      targetGeneration,
      selection: operation.selection,
    };

    const admitted = waitFrame(socket, (value) => value.type === 'handoff_seed_admitted');

    socket.send(JSON.stringify(intent));

    await expect(admitted).resolves.toMatchObject({
      type: 'handoff_seed_admitted',
      operationId: operation.id,
      seedCommandId: operation.seedCommandId,
      targetGeneration,
    });

    await expect(
      relay.db.pool.query('SELECT status,action FROM command_audit WHERE command_id=$1', [
        operation.seedCommandId,
      ]),
    ).resolves.toMatchObject({
      rows: [{ status: CommandStatus.Accepted, action: CommandActionType.Prompt }],
    });

    const retryAdmission = waitFrame(socket, (value) => value.type === 'handoff_seed_admitted');

    socket.send(JSON.stringify(intent));
    await retryAdmission;

    await relay.db.pool.query('UPDATE command_audit SET status=$2 WHERE command_id=$1', [
      operation.seedCommandId,
      CommandStatus.Dispatched,
    ]);

    const proof = {
      type: 'handoff_seed_proof',
      operationId: operation.id,
      seedCommandId: operation.seedCommandId,
      checkpointId: operation.checkpointId,
      checkpointDigest: operation.checkpointDigest,
      targetExecutionId,
      targetGeneration,
      selection: operation.selection,
    };

    const invalidProofs = [
      { ...proof, selection: { ...operation.selection, model: 'wrong-model' } },
      { ...proof, seedCommandId: randomUUID() },
      { ...proof, checkpointId: randomUUID() },
      { ...proof, checkpointDigest: 'f'.repeat(64) },
      { ...proof, targetGeneration: randomUUID() },
      { ...proof, selection: { ...operation.selection, effort: 'low' as const } },
    ];

    await rejectProofs(socket, invalidProofs);
    expect((await relay.db.pool.query('SELECT count(*) FROM handoff_seed_proofs')).rows[0].count).toBe('0');

    await expect(service.getConversation(principal, scope, conversationId)).resolves.toMatchObject({
      activeExecutionId: source.id,
    });

    const validError = waitFrame(socket, (value) => value.type === 'error').catch((error) => error);

    socket.send(JSON.stringify(proof));

    const receivedError = await Promise.race([
      validError,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 200)),
    ]);

    expect(receivedError).toBeNull();

    await expect
      .poll(async () =>
        Number((await relay.db.pool.query('SELECT count(*) FROM handoff_seed_proofs')).rows[0].count),
      )
      .toBe(1);

    await expect(
      service.activateExecution(principal, scope, conversationId, operation.id, 2, 2),
    ).resolves.toMatchObject({ activeExecutionId: targetExecutionId });

    await expect(
      service.activateExecution(principal, scope, conversationId, operation.id, 3, 2),
    ).rejects.toMatchObject({ status: HttpStatus.Conflict });

    await relay.db.pool.query('UPDATE devices SET generation=$2 WHERE id=$1', [
      device.deviceId,
      randomUUID(),
    ]);

    const staleDevice = waitFrame(socket, (value) => value.type === 'error');

    socket.send(JSON.stringify(proof));
    expect((await staleDevice).code).toBe('STALE_EPOCH');
  });
});
