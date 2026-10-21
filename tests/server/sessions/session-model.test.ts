import { ErrorCode, FrameType, HttpStatus, RELAY_PROTOCOL, RelayProtocolFeature } from '@protocol';
import { expect, it } from 'vitest';
import { attachmentRelayFixture } from '../../helpers/relay/attachment-relay.js';

it("asks the owner's live device to switch the model of the current generation and returns its answer", async () => {
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
      protocolVersion: RelayProtocolFeature.ModelSwitchReply - 1,
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

    // The relay waits for the device: a switch the session takes, then one it refuses.
    const taken = choose(f.token, current);
    const request = await device.next(FrameType.SessionModel);

    expect(request).toEqual({
      type: FrameType.SessionModel,
      requestId: expect.any(String),
      sessionId: f.session.id,
      choice,
    });

    device.send({
      type: FrameType.SessionModelResult,
      requestId: request.requestId,
      reply: { ok: true, choice },
    });

    expect(await taken).toEqual({ status: HttpStatus.Ok, body: { choice } });

    const refused = choose(f.token, current);
    const second = await device.next(FrameType.SessionModel);

    device.send({
      type: FrameType.SessionModelResult,
      requestId: second.requestId,
      reply: { ok: false, code: ErrorCode.CAPABILITY_UNAVAILABLE },
    });

    expect((await refused).body).toEqual({ code: ErrorCode.CAPABILITY_UNAVAILABLE });
  } finally {
    await f.close();
  }
});
