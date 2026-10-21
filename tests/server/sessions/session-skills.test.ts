import { ErrorCode, FrameType, HttpStatus, RELAY_PROTOCOL, RelayProtocolFeature } from '@protocol';
import { expect, it } from 'vitest';
import { attachmentRelayFixture } from '../../helpers/relay/attachment-relay.js';

it('reads skills only from the owned live generation and rejects substituted session metadata', async () => {
  const f = await attachmentRelayFixture();

  const read = async (token: string, generation = f.session.generation) => {
    const response = await fetch(
      `${f.origin}/sessions/${encodeURIComponent(f.session.id)}/skills?generation=${generation}`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );

    return { status: response.status, body: await response.json() };
  };

  try {
    const old = f.connect('/ws/device', f.deviceToken, { protocolVersion: RelayProtocolFeature.Skills - 1 });

    await old.next(FrameType.Authenticated);
    expect((await read(f.token)).body).toEqual({ code: ErrorCode.CAPABILITY_UNAVAILABLE });
    old.socket.terminate();
    const device = f.connect('/ws/device', f.deviceToken, { protocolVersion: RELAY_PROTOCOL.Current });

    await device.next(FrameType.Authenticated);
    expect((await read(f.otherToken)).body).toEqual({ code: ErrorCode.NOT_FOUND });
    expect((await read(f.token, 'old')).body).toEqual({ code: ErrorCode.STALE_SESSION });
    const pending = read(f.token);
    const request = await device.next(FrameType.SkillsRequest);

    const skills = {
      sessionId: f.session.id,
      generation: f.session.generation,
      supported: true,
      truncated: false,
      skills: [{ name: 'review', invocation: '/review', description: 'Review changes' }],
    };

    expect(request.sessionId).toBe(f.session.id);
    expect(request.generation).toBe(f.session.generation);
    device.send({ type: FrameType.SkillsResult, requestId: request.requestId, reply: { ok: true, skills } });
    expect(await pending).toEqual({ status: HttpStatus.Ok, body: skills });
    const substituted = read(f.token);
    const second = await device.next(FrameType.SkillsRequest);

    device.send({
      type: FrameType.SkillsResult,
      requestId: second.requestId,
      reply: { ok: true, skills: { ...skills, sessionId: 'another-session' } },
    });

    expect((await substituted).body).toEqual({ code: ErrorCode.INVALID_FRAME });
    const wrongGeneration = read(f.token);
    const third = await device.next(FrameType.SkillsRequest);

    device.send({
      type: FrameType.SkillsResult,
      requestId: third.requestId,
      reply: { ok: true, skills: { ...skills, generation: 'another-generation' } },
    });

    expect((await wrongGeneration).body).toEqual({ code: ErrorCode.INVALID_FRAME });
  } finally {
    await f.close();
  }
});

it('does not accept a skills reply from another owner device', async () => {
  const f = await attachmentRelayFixture();

  try {
    const device = f.connect('/ws/device', f.deviceToken, { protocolVersion: RELAY_PROTOCOL.Current });
    const other = await f.seed(f.otherToken);

    const otherDevice = f.connect('/ws/device', other.deviceToken, {
      protocolVersion: RELAY_PROTOCOL.Current,
    });

    await Promise.all([device.next(FrameType.Authenticated), otherDevice.next(FrameType.Authenticated)]);

    const pending = fetch(
      `${f.origin}/sessions/${encodeURIComponent(f.session.id)}/skills?generation=${f.session.generation}`,
      { headers: { authorization: `Bearer ${f.token}` } },
    );

    const request = await device.next(FrameType.SkillsRequest);

    const skills = {
      sessionId: f.session.id,
      generation: f.session.generation,
      supported: true,
      truncated: false,
      skills: [{ name: 'review', invocation: '/review', description: 'Review changes' }],
    };

    otherDevice.send({
      type: FrameType.SkillsResult,
      requestId: request.requestId,
      reply: { ok: true, skills },
    });

    device.send({ type: FrameType.SkillsResult, requestId: request.requestId, reply: { ok: true, skills } });

    const response = await pending;

    expect(response.status).toBe(HttpStatus.Ok);
    expect(await response.json()).toEqual(skills);
  } finally {
    await f.close();
  }
});

it('invalidates pending skills replies when the paired device reconnects', async () => {
  const f = await attachmentRelayFixture();

  try {
    const previous = f.connect('/ws/device', f.deviceToken, { protocolVersion: RELAY_PROTOCOL.Current });

    await previous.next(FrameType.Authenticated);

    const pending = fetch(
      `${f.origin}/sessions/${encodeURIComponent(f.session.id)}/skills?generation=${f.session.generation}`,
      { headers: { authorization: `Bearer ${f.token}` } },
    );

    const request = await previous.next(FrameType.SkillsRequest);
    const replacement = f.connect('/ws/device', f.deviceToken, { protocolVersion: RELAY_PROTOCOL.Current });

    await replacement.next(FrameType.Authenticated);

    replacement.send({
      type: FrameType.SkillsResult,
      requestId: request.requestId,
      reply: {
        ok: true,
        skills: {
          sessionId: f.session.id,
          generation: f.session.generation,
          supported: true,
          truncated: false,
          skills: [{ name: 'stale', invocation: '/stale', description: 'Old request' }],
        },
      },
    });

    const response = await pending;

    expect(response.status).toBe(HttpStatus.Conflict);
    expect(await response.json()).toEqual({ code: ErrorCode.DEVICE_OFFLINE });
  } finally {
    await f.close();
  }
});

it('rechecks bearer authorization after the device answers a pending skills request', async () => {
  const f = await attachmentRelayFixture();

  try {
    const device = f.connect('/ws/device', f.deviceToken, { protocolVersion: RELAY_PROTOCOL.Current });

    await device.next(FrameType.Authenticated);

    const pending = fetch(
      `${f.origin}/sessions/${encodeURIComponent(f.session.id)}/skills?generation=${f.session.generation}`,
      { headers: { authorization: `Bearer ${f.token}` } },
    );

    const request = await device.next(FrameType.SkillsRequest);

    const logout = await fetch(`${f.origin}/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${f.token}` },
    });

    expect(logout.status).toBe(HttpStatus.Ok);

    device.send({
      type: FrameType.SkillsResult,
      requestId: request.requestId,
      reply: {
        ok: true,
        skills: {
          sessionId: f.session.id,
          generation: f.session.generation,
          supported: true,
          truncated: false,
          skills: [{ name: 'private', invocation: '/private', description: 'Private metadata' }],
        },
      },
    });

    const response = await pending;

    expect(response.status).toBe(HttpStatus.Unauthorized);
    expect(await response.json()).toEqual({ code: ErrorCode.UNAUTHORIZED });
  } finally {
    await f.close();
  }
});

it('rejects a pending skills result when its device is revoked', async () => {
  const f = await attachmentRelayFixture();

  try {
    const device = f.connect('/ws/device', f.deviceToken, { protocolVersion: RELAY_PROTOCOL.Current });

    await device.next(FrameType.Authenticated);

    const pending = fetch(
      `${f.origin}/sessions/${encodeURIComponent(f.session.id)}/skills?generation=${f.session.generation}`,
      { headers: { authorization: `Bearer ${f.token}` } },
    );

    await device.next(FrameType.SkillsRequest);

    const revoked = await fetch(`${f.origin}/devices/${encodeURIComponent(f.deviceId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${f.token}` },
    });

    expect(revoked.status).toBe(HttpStatus.Ok);

    const response = await pending;

    expect(response.status).toBe(HttpStatus.Conflict);
    expect(await response.json()).toEqual({ code: ErrorCode.DEVICE_OFFLINE });
  } finally {
    await f.close();
  }
});
