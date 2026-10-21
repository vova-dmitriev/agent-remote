import { ErrorCode, FrameType, HttpStatus, RELAY_PROTOCOL, RelayProtocolFeature } from '@protocol';
import { expect, it } from 'vitest';
import { attachmentRelayFixture } from '../../helpers/relay/attachment-relay.js';

it('pages the authenticated device catalog with owner-bound cursors and disconnect fencing', async () => {
  const f = await attachmentRelayFixture();

  const read = (token: string, query = '') =>
    fetch(`${f.origin}/devices/${encodeURIComponent(f.deviceId)}/sessions${query}`, {
      headers: { authorization: `Bearer ${token}` },
    });

  try {
    const device = f.connect('/ws/device', f.deviceToken, { protocolVersion: RELAY_PROTOCOL.Current });

    await device.next(FrameType.Authenticated);

    const foreign = await read(f.otherToken);

    expect(foreign.status).toBe(HttpStatus.Conflict);
    expect(await foreign.json()).toEqual({ code: ErrorCode.DEVICE_OFFLINE });

    const firstRead = read(f.token);
    const firstRequest = await device.next(FrameType.SessionListRead);

    expect(firstRequest.provider).toBe('all');

    device.send({
      type: FrameType.SessionListResult,
      requestId: firstRequest.requestId,
      reply: { ok: true, page: { sessions: [f.session], nextCursor: 'device-cursor' } },
    });

    const first = await firstRead;
    const firstBody = await first.json();

    expect(first.status).toBe(HttpStatus.Ok);
    expect(firstBody.sessions.map((session: { id: string }) => session.id)).toEqual([f.session.id]);
    expect(firstBody.nextCursor).toBeTruthy();

    expect((await read(f.otherToken, `?cursor=${encodeURIComponent(firstBody.nextCursor)}`)).status).not.toBe(
      HttpStatus.Ok,
    );

    expect((await read(f.token, '?cursor=not-a-cursor')).status).toBe(HttpStatus.BadRequest);

    expect(
      (await read(f.token, `?provider=claude&cursor=${encodeURIComponent(firstBody.nextCursor)}`)).status,
    ).toBe(HttpStatus.BadRequest);

    const nextRead = read(f.token, `?cursor=${encodeURIComponent(firstBody.nextCursor)}`);
    const nextRequest = await device.next(FrameType.SessionListRead);

    expect(nextRequest.provider).toBe('all');
    expect(nextRequest.cursor).toBe('device-cursor');
    await f.relay.auth.logout(f.token);

    device.send({
      type: FrameType.SessionListResult,
      requestId: nextRequest.requestId,
      reply: { ok: true, page: { sessions: [f.session], nextCursor: null } },
    });

    const next = await nextRead;

    expect(await next.json()).toEqual({ code: ErrorCode.UNAUTHORIZED });
  } finally {
    await f.close();
  }
});

it('requires session-page protocol support', async () => {
  const f = await attachmentRelayFixture();

  try {
    const device = f.connect('/ws/device', f.deviceToken, {
      protocolVersion: RelayProtocolFeature.SessionPages - 1,
    });

    await device.next(FrameType.Authenticated);

    const response = await fetch(`${f.origin}/devices/${encodeURIComponent(f.deviceId)}/sessions`, {
      headers: { authorization: `Bearer ${f.token}` },
    });

    expect(await response.json()).toEqual({ code: ErrorCode.CAPABILITY_UNAVAILABLE });
  } finally {
    await f.close();
  }
});

it('ignores a matching page reply from another owner device', async () => {
  const f = await attachmentRelayFixture();

  try {
    const device = f.connect('/ws/device', f.deviceToken, { protocolVersion: RELAY_PROTOCOL.Current });
    const other = await f.seed(f.otherToken);

    const otherDevice = f.connect('/ws/device', other.deviceToken, {
      protocolVersion: RELAY_PROTOCOL.Current,
    });

    await device.next(FrameType.Authenticated);
    await otherDevice.next(FrameType.Authenticated);

    let settled = false;

    const pending = fetch(`${f.origin}/devices/${encodeURIComponent(f.deviceId)}/sessions`, {
      headers: { authorization: `Bearer ${f.token}` },
    }).then((response) => {
      settled = true;

      return response;
    });

    const request = await device.next(FrameType.SessionListRead);

    otherDevice.send({
      type: FrameType.SessionListResult,
      requestId: request.requestId,
      reply: { ok: true, page: { sessions: [other.session], nextCursor: null } },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    device.send({
      type: FrameType.SessionListResult,
      requestId: request.requestId,
      reply: { ok: true, page: { sessions: [f.session], nextCursor: null } },
    });

    const response = await pending;
    const body = await response.json();

    expect(response.status).toBe(HttpStatus.Ok);
    expect(body.sessions.map((session: { id: string }) => session.id)).toEqual([f.session.id]);
  } finally {
    await f.close();
  }
});
