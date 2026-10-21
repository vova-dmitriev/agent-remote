import {
  ErrorCode,
  FrameType,
  HttpStatus,
  RELAY_PROTOCOL,
  RelayProtocolFeature,
  RuleAction,
} from '@protocol';
import { expect, it } from 'vitest';
import { attachmentRelayFixture } from '../../helpers/relay/attachment-relay.js';

const view = { projects: [], session: null };

it("asks only the owner's live device that keeps rules, and returns its answer", async () => {
  const f = await attachmentRelayFixture();

  const send = async (token: string, body: unknown) => {
    const response = await fetch(`${f.origin}/devices/${encodeURIComponent(f.deviceId)}/rules`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    return { status: response.status, body: await response.json() };
  };

  const ask = { action: RuleAction.View, sessionId: null };

  try {
    expect((await send(f.token, ask)).body).toEqual({ code: ErrorCode.DEVICE_OFFLINE });

    const old = f.connect('/ws/device', f.deviceToken, { protocolVersion: RelayProtocolFeature.Rules - 1 });

    await old.next(FrameType.Authenticated);
    expect((await send(f.token, ask)).body).toEqual({ code: ErrorCode.CAPABILITY_UNAVAILABLE });
    old.socket.terminate();

    const device = f.connect('/ws/device', f.deviceToken, { protocolVersion: RELAY_PROTOCOL.Current });

    await device.next(FrameType.Authenticated);
    expect((await send(f.otherToken, ask)).body).toEqual({ code: ErrorCode.NOT_FOUND });
    expect((await send(f.token, { action: 'synthetic' })).status).toBe(HttpStatus.BadRequest);

    const pending = send(f.token, ask);
    const request = await device.next(FrameType.RulesRequest);

    expect(request).toEqual({ type: FrameType.RulesRequest, requestId: expect.any(String), request: ask });

    device.send({
      type: FrameType.RulesResult,
      requestId: request.requestId,
      reply: { ok: true, rules: view },
    });

    expect(await pending).toMatchObject({ body: view });
  } finally {
    await f.close();
  }
});
