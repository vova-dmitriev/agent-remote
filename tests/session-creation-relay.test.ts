import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { attachmentRelayFixture } from './helpers/attachment-relay.js';

it('fences creation by owner and project, then retains the owned new session result for recovery', async () => {
  const f = await attachmentRelayFixture();

  try {
    const device = f.connect('/ws/device', f.deviceToken);

    await device.next('authenticated');

    const source = {
      ...f.session,
      cwd: '/synthetic/project',
      capabilities: { ...f.session.capabilities, createSession: true },
    };

    await f.publish(device, source);

    const input = {
      commandId: randomUUID(),
      target: source.target,
      sessionId: source.id,
      generation: source.generation,
      action: { type: 'create_session' as const, provider: 'codex' as const, cwd: source.cwd },
    };

    const other = await f.relay.auth.authenticate(f.otherToken);

    await expect(f.relay.command(other, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(
      f.relay.command(f.principal, { ...input, action: { ...input.action, cwd: '/other' } }),
    ).rejects.toMatchObject({ code: 'INVALID_PROJECT' });

    expect(await f.relay.command(f.principal, input)).toMatchObject({ status: 'accepted' });
    await device.next('command');

    const created = {
      ...source,
      id: 'created',
      generation: 'new',
      target: { ...source.target, threadId: 'new' },
    };

    await f.publish(device, created);

    device.send({
      type: 'command_result',
      result: { commandId: input.commandId, status: 'dispatched', sessionId: created.id },
    });

    await expect
      .poll(
        async () =>
          (
            await f.database.db.pool.query(
              'SELECT result_session_id FROM command_audit WHERE command_id=$1',
              [input.commandId],
            )
          ).rows[0]?.result_session_id,
      )
      .toBe(created.id);

    expect(await f.relay.command(f.principal, input)).toMatchObject({
      status: 'dispatched',
      sessionId: created.id,
    });

    const response = await fetch(f.origin + '/commands/' + input.commandId, {
      headers: { authorization: 'Bearer ' + f.token },
    });

    expect(await response.json()).toMatchObject({ status: 'dispatched', sessionId: created.id });
  } finally {
    await f.close();
  }
});
