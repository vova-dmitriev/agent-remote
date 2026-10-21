import { ErrorCode, FrameType, HttpStatus, RELAY_PROTOCOL, RelayProtocolFeature } from '@protocol';
import { expect, it } from 'vitest';
import { attachmentRelayFixture } from '../../helpers/relay/attachment-relay.js';

it("sends a model switch only to the owner's live device that speaks it, for the current generation", async () => {
  const f = await attachmentRelayFixture();

  const choose = async (token: string, body: unknown) => {
    const response = await fetch(`${f.origin}/sessions/${encodeURIComponent(f.session.id)}/model`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    return { status: response.status, body: await response.json() };
  };

  const choice = { model: 'synthetic-model', effort: 'high' };
  const current = { choice, generation: f.session.generation };

  try {
    const old = f.connect('/ws/device', f.deviceToken, {
      protocolVersion: RelayProtocolFeature.ModelChoice - 1,
    });

    await old.next(FrameType.Authenticated);
    expect((await choose(f.token, current)).body).toEqual({ code: ErrorCode.CAPABILITY_UNAVAILABLE });
    old.socket.terminate();

    const device = f.connect('/ws/device', f.deviceToken, { protocolVersion: RELAY_PROTOCOL.Current });

    await device.next(FrameType.Authenticated);

    expect((await choose(f.otherToken, current)).body).toEqual({ code: ErrorCode.NOT_FOUND });

    expect((await choose(f.token, { ...current, generation: 'old' })).body).toEqual({
      code: ErrorCode.STALE_SESSION,
    });

    expect((await choose(f.token, { ...current, choice: { model: 'x', effort: 'ludicrous' } })).status).toBe(
      HttpStatus.BadRequest,
    );

    expect(await choose(f.token, current)).toEqual({ status: HttpStatus.Ok, body: { choice } });

    expect(await device.next(FrameType.SessionModel)).toEqual({
      type: FrameType.SessionModel,
      sessionId: f.session.id,
      choice,
    });
  } finally {
    await f.close();
  }
});
