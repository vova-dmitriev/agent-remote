import {
  AnalyticsPeriod,
  ErrorCode,
  FrameType,
  HttpStatus,
  RELAY_PROTOCOL,
  RelayProtocolFeature,
} from '@protocol';
import { expect, it } from 'vitest';
import { attachmentRelayFixture } from '../../helpers/relay/attachment-relay.js';

const tokens = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 };

const report = {
  period: AnalyticsPeriod.Week,
  importing: null,
  totals: { tokens, costUsd: 1.5 },
  byModel: [],
  byProject: [],
  bySession: [],
  daily: [],
  rateLimits: [],
};

it("asks only the owner's live device that keeps usage, and returns its report", async () => {
  const f = await attachmentRelayFixture();

  const read = async (token: string, period: string, id = f.deviceId) => {
    const response = await fetch(`${f.origin}/devices/${encodeURIComponent(id)}/analytics?period=${period}`, {
      headers: { authorization: `Bearer ${token}` },
    });

    return { status: response.status, body: await response.json() };
  };

  try {
    expect((await read(f.token, AnalyticsPeriod.Week)).body).toEqual({ code: ErrorCode.DEVICE_OFFLINE });

    const old = f.connect('/ws/device', f.deviceToken, {
      protocolVersion: RelayProtocolFeature.Analytics - 1,
    });

    await old.next(FrameType.Authenticated);

    expect((await read(f.token, AnalyticsPeriod.Week)).body).toEqual({
      code: ErrorCode.CAPABILITY_UNAVAILABLE,
    });

    old.socket.terminate();

    const device = f.connect('/ws/device', f.deviceToken, { protocolVersion: RELAY_PROTOCOL.Current });

    await device.next(FrameType.Authenticated);
    expect((await read(f.otherToken, AnalyticsPeriod.Week)).body).toEqual({ code: ErrorCode.NOT_FOUND });
    expect((await read(f.token, 'synthetic-period')).status).toBe(HttpStatus.BadRequest);

    const pending = read(f.token, AnalyticsPeriod.Week);
    const request = await device.next(FrameType.AnalyticsRequest);

    expect(request).toEqual({
      type: FrameType.AnalyticsRequest,
      requestId: expect.any(String),
      period: AnalyticsPeriod.Week,
    });

    // An answer of another kind does not settle it.
    device.send({
      type: FrameType.FileResult,
      requestId: request.requestId,
      reply: { ok: true, file: { path: '/work/NOTES.md', content: '', truncated: false } },
    });

    device.send({
      type: FrameType.AnalyticsResult,
      requestId: request.requestId,
      reply: { ok: true, report },
    });

    expect(await pending).toEqual({ status: HttpStatus.Ok, body: report });
  } finally {
    await f.close();
  }
});
