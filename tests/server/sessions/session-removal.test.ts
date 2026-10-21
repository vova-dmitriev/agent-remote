import {
  ErrorCode,
  FrameType,
  HttpStatus,
  RELAY_PROTOCOL,
  RelayProtocolFeature,
  SessionRemoval,
} from '@protocol';
import { expect, it } from 'vitest';
import { attachmentRelayFixture } from '../../helpers/relay/attachment-relay.js';

it("sends a removal only to the owner's live device that speaks removals, for the current generation", async () => {
  const f = await attachmentRelayFixture();

  const remove = async (token: string, body: unknown, id = f.session.id) => {
    const response = await fetch(`${f.origin}/sessions/${encodeURIComponent(id)}/remove`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    return { status: response.status, body: await response.json() };
  };

  const current = { mode: SessionRemoval.Archive, generation: f.session.generation };

  try {
    expect((await remove(f.token, current)).body).toEqual({ code: ErrorCode.DEVICE_OFFLINE });

    const old = f.connect('/ws/device', f.deviceToken, {
      protocolVersion: RelayProtocolFeature.SessionRemove - 1,
    });

    await old.next(FrameType.Authenticated);
    expect((await remove(f.token, current)).body).toEqual({ code: ErrorCode.CAPABILITY_UNAVAILABLE });
    old.socket.terminate();

    const device = f.connect('/ws/device', f.deviceToken, { protocolVersion: RELAY_PROTOCOL.Current });

    await device.next(FrameType.Authenticated);

    expect((await remove(f.otherToken, current)).body).toEqual({ code: ErrorCode.NOT_FOUND });

    expect((await remove(f.token, { ...current, generation: 'old' })).body).toEqual({
      code: ErrorCode.STALE_SESSION,
    });

    expect((await remove(f.token, { ...current, mode: 'delete' })).status).toBe(HttpStatus.BadRequest);

    expect(await remove(f.token, current)).toEqual({
      status: HttpStatus.Ok,
      body: { mode: SessionRemoval.Archive },
    });

    expect(await device.next(FrameType.SessionRemove)).toEqual({
      type: FrameType.SessionRemove,
      sessionId: f.session.id,
      mode: SessionRemoval.Archive,
    });
  } finally {
    await f.close();
  }
});
