import { FrameType, HttpStatus, RELAY_PROTOCOL } from '@protocol';
import { expect, it } from 'vitest';
import { attachmentRelayFixture } from '../../helpers/relay/attachment-relay.js';

it('asks a device that speaks renames to rename in the agent and keeps a relay label only for one that cannot', async () => {
  const f = await attachmentRelayFixture();

  const rename = async (title: string) => {
    const response = await fetch(`${f.origin}/sessions/${encodeURIComponent(f.session.id)}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${f.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ title, generation: f.session.generation }),
    });

    expect(response.status).toBe(HttpStatus.Ok);
  };

  const labels = async () =>
    (
      await f.database.db.pool.query('SELECT title FROM session_labels WHERE device_id=$1', [f.deviceId])
    ).rows.map((row: { title: string }) => row.title);

  try {
    // A daemon that negotiated no version cannot rename in its agent: the relay keeps the name.
    const old = f.connect('/ws/device', f.deviceToken);

    await old.next(FrameType.Authenticated);
    await rename('Relay label');
    expect(await labels()).toEqual(['Relay label']);
    expect(old.frames.some((frame) => frame.type === FrameType.SessionRename)).toBe(false);
    old.socket.terminate();

    const device = f.connect('/ws/device', f.deviceToken, { protocolVersion: RELAY_PROTOCOL.Current });

    await device.next(FrameType.Authenticated);
    await rename('Agent name');

    expect(await device.next(FrameType.SessionRename)).toEqual({
      type: FrameType.SessionRename,
      sessionId: f.session.id,
      title: 'Agent name',
    });

    expect(await labels()).toEqual([]);
  } finally {
    await f.close();
  }
});
