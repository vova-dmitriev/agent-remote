import { ConsoleLogger } from '@nestjs/common';
import { ErrorCode, FrameType, type ServerFrame } from '@protocol';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { DeviceRepository } from '../../../apps/server/src/devices/repositories/devices.js';
import { DeviceService } from '../../../apps/server/src/devices/service.js';
import { attachmentRelayFixture } from '../../helpers/attachment-relay.js';

let f: Awaited<ReturnType<typeof attachmentRelayFixture>>;
const secret = 'synthetic chat message text';

beforeEach(async () => {
  f = await attachmentRelayFixture();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await f?.close();
});

/** Logged errors for one context, with every argument as text. */
function errorsFor(logged: { mock: { calls: unknown[][] } }, context: string) {
  return logged.mock.calls.filter((call) => call.at(-1) === context).map((call) => JSON.stringify(call));
}

it('logs an unexpected failure handling a device frame and answers INTERNAL_ERROR', async () => {
  const socket = new WebSocket(f.origin.replace('http:', 'ws:') + '/ws/device');
  const frames: ServerFrame[] = [];

  socket.on('message', (raw) => frames.push(JSON.parse(String(raw)) as ServerFrame));
  await once(socket, 'open');
  socket.send(JSON.stringify({ type: FrameType.Auth, token: f.deviceToken }));
  await expect.poll(() => frames.some((frame) => frame.type === FrameType.Authenticated)).toBe(true);

  const logged = vi.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(() => {});

  vi.spyOn(DeviceRepository.prototype, 'touch').mockRejectedValue(new Error(secret));
  socket.send(JSON.stringify({ type: FrameType.Heartbeat }));

  await expect
    .poll(() => frames.find((frame) => frame.type === FrameType.Error))
    .toEqual({ type: FrameType.Error, code: ErrorCode.INTERNAL_ERROR });

  const errors = errorsFor(logged, 'DeviceSocket');

  expect(errors).toHaveLength(1);
  expect(errors[0]).not.toContain(secret);
  socket.terminate();
});

it('logs an unexpected failure handling an app frame and answers INTERNAL_ERROR', async () => {
  const app = f.connect('/ws/app', f.token);

  await app.next(FrameType.Authenticated);

  const logged = vi.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(() => {});

  vi.spyOn(DeviceService.prototype, 'owned').mockRejectedValue(new Error(secret));
  app.send({ type: FrameType.Subscribe, deviceId: f.deviceId, sessionId: null });

  expect(await app.next(FrameType.Error)).toEqual({ type: FrameType.Error, code: ErrorCode.INTERNAL_ERROR });

  const errors = errorsFor(logged, 'AppSocket');

  expect(errors).toHaveLength(1);
  expect(errors[0]).not.toContain(secret);
});

it('does not log a client fault on a socket', async () => {
  const app = f.connect('/ws/app', f.token);

  await app.next(FrameType.Authenticated);

  const logged = vi.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(() => {});

  app.send({ type: FrameType.Subscribe, deviceId: 'not-owned-device', sessionId: null });

  expect(await app.next(FrameType.Error)).toEqual({ type: FrameType.Error, code: ErrorCode.NOT_FOUND });
  expect(logged).not.toHaveBeenCalled();
});

/** A raw socket that records frames; it authenticates first when given a token. */
async function rawSocket(path: string, token?: string) {
  const socket = new WebSocket(f.origin.replace('http:', 'ws:') + path, { origin: 'http://localhost' });
  const frames: ServerFrame[] = [];

  socket.on('message', (raw) => frames.push(JSON.parse(String(raw)) as ServerFrame));
  await once(socket, 'open');

  if (token) {
    socket.send(JSON.stringify({ type: FrameType.Auth, token }));
    await expect.poll(() => frames.some((frame) => frame.type === FrameType.Authenticated)).toBe(true);
  }

  return { socket, frames };
}

describe.each([
  ['app', '/ws/app', () => f.token],
  ['device', '/ws/device', () => f.deviceToken],
])('a malformed %s frame', (_kind, path, token) => {
  it.each([
    ['before authentication', false],
    ['after authentication', true],
  ])('%s is a client fault and is not logged', async (_moment, authenticated) => {
    const { socket, frames } = await rawSocket(path, authenticated ? token() : undefined);
    const errors = vi.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(() => {});
    const warnings = vi.spyOn(ConsoleLogger.prototype, 'warn').mockImplementation(() => {});

    socket.send('not json {');

    await expect
      .poll(() => frames.find((frame) => frame.type === FrameType.Error))
      .toEqual({ type: FrameType.Error, code: ErrorCode.INVALID_FRAME });

    if (authenticated) {
      // A JSON value that is not a frame fails the frame schema: an invalid request, also not logged.
      socket.send('42');

      await expect.poll(() => frames.filter((frame) => frame.type === FrameType.Error).length).toBe(2);

      expect(frames.filter((frame) => frame.type === FrameType.Error).at(-1)).toEqual({
        type: FrameType.Error,
        code: ErrorCode.INVALID_REQUEST,
      });
    }

    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    socket.terminate();
  });
});
