import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ErrorCode, LocalFeature, LOCAL_LIMITS } from '@protocol';
import { FramedPeer } from '../apps/daemon/src/browser/transport/peer.js';
import { probeCompanion } from '../apps/daemon/src/local/bootstrap/probe.js';
import { startLocalServer } from '../apps/daemon/src/local/server/server.js';
import { localFixture } from './helpers/local-runtime.js';

const cleanups: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) {
    await close();
  }
});

it('confirms desktop grant support before connecting to a compatible companion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-feature-'));
  const path = join(directory, 'client.sock');
  const capability = randomBytes(32).toString('hex');
  const runtime = localFixture();

  const server = await startLocalServer({
    path,
    capability,
    controller: runtime.controller,
    grants: runtime.grants,
  });

  cleanups.push(() => rm(directory, { recursive: true, force: true }), runtime.close, server.close);
  const health = await probeCompanion(path, capability, LocalFeature.DesktopGrants);

  expect(health?.protocolVersion).toBe(LOCAL_LIMITS.protocolVersion);
  expect(health?.features).toContain(LocalFeature.DesktopGrants);
});

it('rejects an old protocol-version-matching daemon that lacks desktop feature negotiation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-old-daemon-'));
  const path = join(directory, 'client.sock');

  const server = createServer((socket) => {
    new FramedPeer(socket, socket, () => {
      socket.destroy();
    });
  });

  await new Promise<void>((resolve) => server.listen(path, resolve));

  cleanups.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
    () => rm(directory, { recursive: true, force: true }),
  );

  await expect(
    probeCompanion(path, randomBytes(32).toString('hex'), LocalFeature.DesktopGrants),
  ).rejects.toThrow(ErrorCode.LOCAL_COMPANION_MISMATCH);
});
