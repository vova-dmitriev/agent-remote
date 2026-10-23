import { ErrorCode, FrameType, HttpStatus, RELAY_PROTOCOL, RelayProtocolFeature } from '@protocol';
import { expect, it } from 'vitest';
import { attachmentRelayFixture } from '../../helpers/relay/attachment-relay.js';

it("sends a read mark only to the owner's live device that keeps marks, for the current generation", async () => {
  const f = await attachmentRelayFixture();

  const read = async (token: string, body: unknown, id = f.session.id) => {
    const response = await fetch(`${f.origin}/sessions/${encodeURIComponent(id)}/read`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    return { status: response.status, body: await response.json() };
  };

  const current = { at: 1_000, generation: f.session.generation };

  try {
    // A daemon from before read marks would reject the frame.
    const old = f.connect('/ws/device', f.deviceToken, {
      protocolVersion: RelayProtocolFeature.SessionUnread - 1,
    });

    await old.next(FrameType.Authenticated);
    expect((await read(f.token, current)).body).toEqual({ code: ErrorCode.CAPABILITY_UNAVAILABLE });
    old.socket.terminate();

    const device = f.connect('/ws/device', f.deviceToken, { protocolVersion: RELAY_PROTOCOL.Current });

    await device.next(FrameType.Authenticated);

    expect((await read(f.otherToken, current)).body).toEqual({ code: ErrorCode.NOT_FOUND });

    expect((await read(f.token, { ...current, generation: 'old' })).body).toEqual({
      code: ErrorCode.STALE_SESSION,
    });

    expect((await read(f.token, { at: -1, generation: f.session.generation })).status).toBe(
      HttpStatus.BadRequest,
    );

    expect(await read(f.token, current)).toEqual({ status: HttpStatus.Ok, body: { at: 1_000 } });

    expect(await device.next(FrameType.SessionRead)).toEqual({
      type: FrameType.SessionRead,
      sessionId: f.session.id,
      at: 1_000,
    });
  } finally {
    await f.close();
  }
});
