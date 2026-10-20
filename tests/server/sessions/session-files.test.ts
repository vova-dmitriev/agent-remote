import { ErrorCode, FrameType, HttpStatus, RELAY_PROTOCOL, RelayProtocolFeature } from '@protocol';
import { expect, it } from 'vitest';
import { attachmentRelayFixture } from '../../helpers/relay/attachment-relay.js';

it("asks only the owner's live device that reads files, and returns its answer", async () => {
  const f = await attachmentRelayFixture();

  const read = async (token: string, path: string, id = f.session.id) => {
    const response = await fetch(
      `${f.origin}/sessions/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );

    return { status: response.status, body: await response.json() };
  };

  try {
    expect((await read(f.token, '/work/NOTES.md')).body).toEqual({ code: ErrorCode.DEVICE_OFFLINE });

    const old = f.connect('/ws/device', f.deviceToken, {
      protocolVersion: RelayProtocolFeature.SessionFiles - 1,
    });

    await old.next(FrameType.Authenticated);
    expect((await read(f.token, '/work/NOTES.md')).body).toEqual({ code: ErrorCode.CAPABILITY_UNAVAILABLE });
    old.socket.terminate();

    const device = f.connect('/ws/device', f.deviceToken, { protocolVersion: RELAY_PROTOCOL.Current });

    await device.next(FrameType.Authenticated);
    expect((await read(f.otherToken, '/work/NOTES.md')).body).toEqual({ code: ErrorCode.NOT_FOUND });
    expect((await read(f.token, '')).status).toBe(HttpStatus.BadRequest);

    const pending = read(f.token, '/work/NOTES.md');
    const request = await device.next(FrameType.FileRequest);

    expect(request).toEqual({
      type: FrameType.FileRequest,
      requestId: expect.any(String),
      sessionId: f.session.id,
      path: '/work/NOTES.md',
    });

    const file = { path: '/work/NOTES.md', content: '# Notes', truncated: false };

    device.send({ type: FrameType.FileResult, requestId: request.requestId, reply: { ok: true, file } });
    expect(await pending).toEqual({ status: HttpStatus.Ok, body: file });

    const refused = read(f.token, '/etc/passwd');
    const second = await device.next(FrameType.FileRequest);

    device.send({
      type: FrameType.FileResult,
      requestId: second.requestId,
      reply: { ok: false, code: ErrorCode.ACCESS_DENIED },
    });

    expect((await refused).body).toEqual({ code: ErrorCode.ACCESS_DENIED });
  } finally {
    await f.close();
  }
});
