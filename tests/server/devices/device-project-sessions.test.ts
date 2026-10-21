import {
  AgentProvider,
  ErrorCode,
  FrameType,
  HttpStatus,
  RELAY_PROTOCOL,
  RelayProtocolFeature,
} from '@protocol';
import { expect, it } from 'vitest';
import { attachmentRelayFixture } from '../../helpers/relay/attachment-relay.js';

it("starts a session in a project only on the owner's live device, and returns the device's answer", async () => {
  const f = await attachmentRelayFixture();

  const send = async (token: string, body: unknown) => {
    const response = await fetch(`${f.origin}/devices/${encodeURIComponent(f.deviceId)}/sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    return { status: response.status, body: await response.json() };
  };

  const session = { provider: AgentProvider.Codex, cwd: '/synthetic/projects/alpha' };

  try {
    expect((await send(f.token, session)).body).toEqual({ code: ErrorCode.DEVICE_OFFLINE });

    const old = f.connect('/ws/device', f.deviceToken, {
      protocolVersion: RelayProtocolFeature.ProjectSessions - 1,
    });

    await old.next(FrameType.Authenticated);
    expect((await send(f.token, session)).body).toEqual({ code: ErrorCode.CAPABILITY_UNAVAILABLE });
    old.socket.terminate();

    const device = f.connect('/ws/device', f.deviceToken, { protocolVersion: RELAY_PROTOCOL.Current });

    await device.next(FrameType.Authenticated);
    expect((await send(f.otherToken, session)).body).toEqual({ code: ErrorCode.NOT_FOUND });
    expect((await send(f.token, { ...session, cwd: 'relative' })).status).toBe(HttpStatus.BadRequest);

    const started = send(f.token, session);
    const request = await device.next(FrameType.SessionCreate);

    expect(request).toEqual({ type: FrameType.SessionCreate, requestId: expect.any(String), session });

    device.send({
      type: FrameType.SessionCreateResult,
      requestId: request.requestId,
      reply: { ok: true, sessionId: 'new' },
    });

    expect(await started).toEqual({ status: HttpStatus.Ok, body: { sessionId: 'new' } });

    const refused = send(f.token, session);
    const second = await device.next(FrameType.SessionCreate);

    device.send({
      type: FrameType.SessionCreateResult,
      requestId: second.requestId,
      reply: { ok: false, code: ErrorCode.INVALID_PROJECT },
    });

    expect((await refused).body).toEqual({ code: ErrorCode.INVALID_PROJECT });
  } finally {
    await f.close();
  }
});
