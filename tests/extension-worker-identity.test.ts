import { afterEach, expect, it, vi } from 'vitest';
import { attachViewer } from '../apps/chrome-extension/src/background/broker.js';
import { ViewerRegistry } from '../apps/chrome-extension/src/background/registry.js';
import { ErrorCode, LocalKind, LocalOperation } from '@protocol';
import { nativeValue, workerFixture, workerPort } from './extension-worker.fixture.js';

afterEach(() => vi.useRealTimers());

const hello = (requestId: string) => ({
  kind: LocalKind.Hello,
  version: 1,
  requestId,
  clientId: crypto.randomUUID(),
  handle: 'renderer-injected-handle',
});

it('serializes simultaneous first-page handshakes using worker identity and acknowledged handle', async () => {
  const f = workerFixture();
  const first = workerPort();
  const second = workerPort();

  attachViewer(first.port, f.api);
  attachViewer(second.port, f.api);
  first.message(hello('first'));
  second.message(hello('second'));
  await vi.waitFor(() => expect(f.native).toHaveLength(1));
  const canonical = nativeValue(f.native[0]!);

  expect(canonical).not.toHaveProperty('handle');

  f.native[0]!.native({
    kind: LocalKind.Result,
    requestId: 'first',
    ok: true,
    data: { lease: 'lease-one', handle: 'native-authorized', ownerId: 'owner', deviceId: 'device' },
  });

  await vi.waitFor(() => expect(f.native).toHaveLength(2));

  expect(nativeValue(f.native[1]!)).toMatchObject({
    clientId: canonical.clientId,
    handle: 'native-authorized',
  });

  f.native[1]!.native({
    kind: LocalKind.Result,
    requestId: 'second',
    ok: true,
    data: { lease: 'lease-two', handle: 'native-authorized', ownerId: 'owner', deviceId: 'device' },
  });

  await vi.waitFor(() => expect(second.posted).toHaveLength(1));
  first.close();
  second.close();
});

it('does not consume viewer slots for rejected senders', async () => {
  const f = workerFixture();
  const registry = new ViewerRegistry(f.api);

  for (let index = 0; index < 40; index++) {
    registry.attach(workerPort(false).port);
  }

  const valid = workerPort();

  registry.attach(valid.port);
  valid.message(hello('valid'));
  await vi.waitFor(() => expect(f.native).toHaveLength(1));
  expect(valid.disconnected()).toBe(false);
  valid.close();
});

it('reclaims valid-viewer slots when traffic closes the port synchronously', async () => {
  const f = workerFixture();
  const registry = new ViewerRegistry(f.api);

  for (let index = 0; index < 40; index++) {
    const rejected = workerPort();

    registry.attach(rejected.port);
    rejected.message({ operation: 'shell' });
  }

  const valid = workerPort();

  registry.attach(valid.port);
  valid.message(hello('after-rejected'));
  await vi.waitFor(() => expect(f.native).toHaveLength(1));
  expect(valid.disconnected()).toBe(false);
  valid.close();
});

it('releases timed-out request slots and ignores late native responses', async () => {
  const f = workerFixture();
  const viewer = workerPort();

  attachViewer(viewer.port, f.api);
  viewer.message(hello('ready'));
  await vi.waitFor(() => expect(f.native).toHaveLength(1));

  f.native[0]!.native({
    kind: LocalKind.Result,
    requestId: 'ready',
    ok: true,
    data: { lease: 'lease', handle: 'authorized', ownerId: 'owner', deviceId: 'device' },
  });

  await vi.waitFor(() => expect(viewer.posted).toHaveLength(1));
  vi.useFakeTimers();

  for (let index = 0; index < 64; index++) {
    viewer.message({
      kind: LocalKind.Request,
      version: 1,
      requestId: 'expired-' + index,
      lease: 'lease',
      action: { operation: LocalOperation.Devices },
    });
  }

  await vi.advanceTimersByTimeAsync(30_000);
  expect(viewer.posted).toHaveLength(65);
  expect(viewer.posted.at(-1)).toMatchObject({ ok: false, code: ErrorCode.REQUEST_TIMEOUT });

  viewer.message({
    kind: LocalKind.Request,
    version: 1,
    requestId: 'new',
    lease: 'lease',
    action: { operation: LocalOperation.Devices },
  });

  f.native[0]!.native({ kind: LocalKind.Result, requestId: 'expired-0', ok: true, data: [] });
  f.native[0]!.native({ kind: LocalKind.Result, requestId: 'new', ok: true, data: [] });
  await vi.waitFor(() => expect(viewer.posted.at(-1)).toMatchObject({ requestId: 'new', ok: true }));
  expect(viewer.disconnected()).toBe(false);
  viewer.close();
});
