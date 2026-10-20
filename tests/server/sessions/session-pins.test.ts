import { ErrorCode, FrameType, HttpStatus, RELAY_PROTOCOL } from '@protocol';
import { expect, it } from 'vitest';
import { attachmentRelayFixture } from '../../helpers/relay/attachment-relay.js';

it("sends a pin only to the owner's live device that speaks pins, for the current generation", async () => {
  const f = await attachmentRelayFixture();

  const pin = async (token: string, body: unknown, id = f.session.id) => {
    const response = await fetch(`${f.origin}/sessions/${encodeURIComponent(id)}/pin`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    return { status: response.status, body: await response.json() };
  };

  const current = { pinned: true, generation: f.session.generation };

  try {
    expect((await pin(f.token, current)).body).toEqual({ code: ErrorCode.DEVICE_OFFLINE });

    // A daemon that negotiated no version predates pins and would reject the frame.
    const old = f.connect('/ws/device', f.deviceToken);

    await old.next(FrameType.Authenticated);
    expect((await pin(f.token, current)).body).toEqual({ code: ErrorCode.CAPABILITY_UNAVAILABLE });
    old.socket.terminate();

    const device = f.connect('/ws/device', f.deviceToken, { protocolVersion: RELAY_PROTOCOL.Current });

    await device.next(FrameType.Authenticated);

    expect((await pin(f.otherToken, current)).body).toEqual({ code: ErrorCode.NOT_FOUND });
    expect((await pin(f.token, current, 'session-unknown')).body).toEqual({ code: ErrorCode.NOT_FOUND });

    expect((await pin(f.token, { ...current, generation: 'old' })).body).toEqual({
      code: ErrorCode.STALE_SESSION,
    });

    expect((await pin(f.token, { pinned: 'yes', generation: f.session.generation })).status).toBe(
      HttpStatus.BadRequest,
    );

    expect(await pin(f.token, current)).toEqual({ status: HttpStatus.Ok, body: { pinned: true } });

    expect(await device.next(FrameType.SessionPin)).toEqual({
      type: FrameType.SessionPin,
      sessionId: f.session.id,
      pinned: true,
    });

    await f.database.db.pool.query('UPDATE devices SET revoked_at=1 WHERE id=$1', [f.deviceId]);
    expect((await pin(f.token, current)).body).toEqual({ code: ErrorCode.NOT_FOUND });
  } finally {
    await f.close();
  }
});
