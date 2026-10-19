import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { CommandStatus, type HandoffOperation, HttpStatus } from '@protocol';
import type { ContinuityService } from '../../apps/server/src/continuity/service.js';
import type { ContinuityReadScope, InitialExecution } from '../../apps/server/src/continuity/types.js';
import { readyTargetSnapshot, waitFrame, type HandoffProofFixture } from './handoff-proof-fixture.js';

export async function dispatchAndCheckCreateEvidence(input: {
  relay: HandoffProofFixture['relay'];
  socket: HandoffProofFixture['socket'];
  principal: HandoffProofFixture['principal'];
  scope: ContinuityReadScope;
  service: ContinuityService;
  operation: HandoffOperation;
  source: InitialExecution;
}) {
  const { relay, socket, principal, scope, service, operation, source } = input;
  const sourceSnapshot = readyTargetSnapshot(scope.deviceId, source.nativeSessionId, source.generation);

  socket.send(JSON.stringify({ type: 'snapshot', snapshot: sourceSnapshot, connectors: [] }));
  await expectSession(relay, principal.userId, scope.deviceId, source.nativeSessionId);

  await expect(
    relay.command(principal, {
      commandId: operation.createCommandId,
      target: sourceSnapshot.sessions[0]!.target,
      sessionId: source.nativeSessionId,
      generation: source.generation,
      action: {
        type: 'create_session',
        provider: operation.selection.provider,
        cwd: sourceSnapshot.sessions[0]!.cwd!,
        execution: { selection: operation.selection, expectedVersion: operation.expectedProfileVersion },
      },
    }),
  ).rejects.toMatchObject({ code: 'CONTINUITY_COMMAND_ID_RESERVED', status: HttpStatus.Conflict });

  const create = relay.dispatchHandoffCreate(principal, operation.id);
  const frame = await waitFrame(socket, (value) => value.type === 'command');
  const command = frame.command as { commandId: string };
  const nativeSessionId = randomUUID();
  const targetGeneration = randomUUID();
  const targetExecutionId = randomUUID();
  const snapshot = readyTargetSnapshot(scope.deviceId, nativeSessionId, targetGeneration);

  socket.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));
  await create;

  socket.send(
    JSON.stringify({
      type: 'command_result',
      result: { commandId: command.commandId, status: CommandStatus.Dispatched, sessionId: nativeSessionId },
    }),
  );

  await expectDispatched(relay, principal.userId, operation.createCommandId, nativeSessionId);

  const target: InitialExecution = {
    conversationId: operation.conversationId,
    id: targetExecutionId,
    provider: operation.selection.provider,
    profileId: operation.selection.profileId,
    mode: 'managed_cli',
    nativeSessionId,
    generation: targetGeneration,
  };

  const codes: string[] = [];

  for (const [selection, version, model] of [
    [{ ...operation.selection, model: 'wrong-model' }, operation.expectedProfileVersion, 'claude-test'],
    [{ ...operation.selection, effort: 'low' }, operation.expectedProfileVersion, 'claude-test'],
    [operation.selection, operation.expectedProfileVersion + 1, 'claude-test'],
    [operation.selection, operation.expectedProfileVersion, 'wrong-model'],
  ] as const) {
    await relay.db.pool.query(
      'UPDATE command_audit SET create_selection=$3,create_expected_profile_version=$4 WHERE owner_id=$1 AND command_id=$2',
      [principal.userId, operation.createCommandId, selection, version],
    );

    if (model !== 'claude-test') {
      await relay.db.pool.query('UPDATE devices SET snapshot=$2 WHERE id=$1', [
        scope.deviceId,
        readyTargetSnapshot(scope.deviceId, nativeSessionId, targetGeneration, model),
      ]);
    }

    try {
      await service.recordCreatedTarget(principal, scope, operation.id, 1, target);
      codes.push('accepted');
    } catch (error) {
      codes.push((error as { code: string }).code);
    }

    if (
      (await service.getConversation(principal, scope, operation.conversationId)).activeExecutionId !==
      source.id
    ) {
      codes.push('source-changed');
    }
  }

  await relay.db.pool.query('UPDATE devices SET snapshot=$2 WHERE id=$1', [scope.deviceId, snapshot]);

  return { snapshot, nativeSessionId, targetExecutionId, targetGeneration, codes };
}

async function expectSession(
  relay: HandoffProofFixture['relay'],
  ownerId: string,
  deviceId: string,
  sessionId: string,
) {
  await expect
    .poll(async () =>
      Boolean(
        (
          await relay.db.pool.query('SELECT id FROM sessions WHERE owner_id=$1 AND device_id=$2 AND id=$3', [
            ownerId,
            deviceId,
            sessionId,
          ])
        ).rowCount,
      ),
    )
    .toBe(true);
}

async function expectDispatched(
  relay: HandoffProofFixture['relay'],
  ownerId: string,
  commandId: string,
  sessionId: string,
) {
  await expect
    .poll(
      async () =>
        (
          await relay.db.pool.query(
            'SELECT status,result_session_id FROM command_audit WHERE owner_id=$1 AND command_id=$2',
            [ownerId, commandId],
          )
        ).rows[0],
    )
    .toMatchObject({ status: CommandStatus.Dispatched, result_session_id: sessionId });
}
