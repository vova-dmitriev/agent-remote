import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { attachmentRelayFixture } from '../../helpers/attachment-relay.js';

it('accepts only owned explicit immediate busy prompts at the relay and forwards delivery unchanged', async () => {
  const f = await attachmentRelayFixture();

  try {
    const device = f.connect('/ws/device', f.deviceToken);

    await device.next('authenticated');
    const source = { ...f.session, status: 'running' as const };

    await f.publish(device, source);

    const ordinary = {
      commandId: randomUUID(),
      target: source.target,
      sessionId: source.id,
      generation: source.generation,
      action: { type: 'prompt' as const, text: 'Synthetic follow-up' },
    };

    await expect(f.relay.command(f.principal, ordinary)).rejects.toMatchObject({ code: 'SESSION_NOT_IDLE' });

    const immediate = {
      ...ordinary,
      commandId: randomUUID(),
      action: { ...ordinary.action, delivery: 'immediate' as const },
    };

    await expect(
      f.relay.command(await f.relay.auth.authenticate(f.otherToken), immediate),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(f.relay.command(f.principal, { ...immediate, generation: 'stale' })).rejects.toMatchObject({
      code: 'STALE_SESSION',
    });

    expect(await f.relay.command(f.principal, immediate)).toMatchObject({ status: 'accepted' });
    const sent = await device.next('command');

    expect(sent.command.action).toEqual({
      type: 'prompt',
      text: 'Synthetic follow-up',
      delivery: 'immediate',
    });

    await f.publish(device, { ...source, status: 'waiting_permission' });

    await expect(
      f.relay.command(f.principal, { ...immediate, commandId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_IDLE' });
  } finally {
    await f.close();
  }
});
