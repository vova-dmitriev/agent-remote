import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { attachmentRelayFixture } from '../../helpers/relay/attachment-relay.js';

it('authorizes only the owned native restart and persists its same-session receipt across rebinding', async () => {
  const f = await attachmentRelayFixture();

  try {
    const device = f.connect('/ws/device', f.deviceToken);

    await device.next('authenticated');

    const source = {
      ...f.session,
      target: {
        kind: 'claude-code-cli' as const,
        deviceId: f.deviceId,
        connectorId: 'native',
        claudeSessionId: 'native-source',
      },
      claudeSessionId: 'native-source',
      binding: 'unverified' as const,
      integrationState: 'needs_restart' as const,
      capabilities: { ...f.session.capabilities, prompt: false, restartSession: true },
    };

    await f.publish(device, source);

    const command = {
      commandId: randomUUID(),
      target: source.target,
      sessionId: source.id,
      generation: source.generation,
      action: { type: 'restart_session' as const },
    };

    await expect(
      f.relay.command(await f.relay.auth.authenticate(f.otherToken), command),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(f.relay.command(f.principal, { ...command, generation: 'stale' })).rejects.toMatchObject({
      code: 'STALE_SESSION',
    });

    expect(await f.relay.command(f.principal, command)).toMatchObject({ status: 'accepted' });
    await device.next('command');

    await f.publish(device, {
      ...source,
      generation: 'resumed',
      target: { ...source.target, connectorId: 'wrapper' },
      binding: 'verified',
      integrationState: 'ready',
      capabilities: { ...source.capabilities, prompt: true, restartSession: false },
    });

    device.send({
      type: 'command_result',
      result: { commandId: command.commandId, status: 'dispatched', sessionId: source.id },
    });

    await expect
      .poll(
        async () =>
          (
            await f.database.db.pool.query(
              'SELECT result_session_id FROM command_audit WHERE command_id=$1',
              [command.commandId],
            )
          ).rows[0]?.result_session_id,
      )
      .toBe(source.id);

    expect(await f.relay.command(f.principal, command)).toMatchObject({
      status: 'dispatched',
      sessionId: source.id,
    });

    await expect(f.relay.command(f.principal, { ...command, commandId: randomUUID() })).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
  } finally {
    await f.close();
  }
});
