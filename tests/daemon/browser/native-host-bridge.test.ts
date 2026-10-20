import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { localFixture, localTestOrigin } from '../../helpers/local/local-runtime.js';
import { startLocalServer } from '@daemon/local/server/server.js';
import { FramedPeer } from '@daemon/browser/transport/peer.js';
import { runNativeHost } from '@daemon/browser/host/bridge.js';
import { LocalOrigin } from '@protocol';

const cleanups: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) {
    await close();
  }
});

it('relays approved requests over real stdio framing and returns pending approval errors before closing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-bridge-test-'));
  const runtime = localFixture();
  const capability = randomBytes(32).toString('hex');
  const path = join(directory, 'client.sock');

  const server = await startLocalServer({
    path,
    capability,
    controller: runtime.controller,
    grants: runtime.grants,
  });

  cleanups.push(() => rm(directory, { recursive: true, force: true }), runtime.close, server.close);
  const input = new PassThrough();
  const output = new PassThrough();
  const received: unknown[] = [];

  const ui = new FramedPeer(output, input, (value) => {
    received.push(value);
  });

  const running = runNativeHost({ input, output }, { path, capability, origin: localTestOrigin });

  await ui.send({ kind: 'hello', version: 1, requestId: 'hello-1', clientId: randomUUID() });
  await expect.poll(() => received.length).toBe(1);

  expect(received).toEqual([
    { kind: 'result', requestId: 'hello-1', ok: false, code: 'LOCAL_APPROVAL_REQUIRED' },
  ]);

  ui.close();
  await running;
});

it('does not accept a renderer supplied desktop origin or principal on the Chrome bridge', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-bridge-forged-'));
  const runtime = localFixture();
  const capability = randomBytes(32).toString('hex');
  const path = join(directory, 'client.sock');

  const server = await startLocalServer({
    path,
    capability,
    controller: runtime.controller,
    grants: runtime.grants,
  });

  cleanups.push(() => rm(directory, { recursive: true, force: true }), runtime.close, server.close);
  const input = new PassThrough();
  const output = new PassThrough();
  const ui = new FramedPeer(output, input, () => {});
  const running = runNativeHost({ input, output }, { path, capability, origin: localTestOrigin });

  await ui.send({
    kind: 'hello',
    version: 1,
    requestId: 'forged-hello',
    clientId: randomUUID(),
    origin: LocalOrigin.Desktop,
    principal: { ownerId: 'forged-owner' },
  });

  await running;

  expect(runtime.grants.pending()).toEqual([]);
});
