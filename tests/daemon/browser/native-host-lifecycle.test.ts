import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { localFixture, localTestOrigin } from '../../helpers/local-runtime.js';
import { FramedPeer } from '../../../apps/daemon/src/browser/transport/peer.js';
import { startLocalServer } from '../../../apps/daemon/src/local/server/server.js';
import { probeCompanion } from '../../../apps/daemon/src/local/bootstrap/probe.js';

const cleanups: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) {
    await close();
  }
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'agent-local-test-'));
  const runtime = localFixture();
  const path = join(directory, 'client.sock');
  const capability = randomBytes(32).toString('hex');

  const server = await startLocalServer({
    path,
    capability,
    controller: runtime.controller,
    grants: runtime.grants,
  });

  cleanups.push(() => rm(directory, { recursive: true, force: true }), runtime.close, server.close);

  return { runtime, path, capability };
}

it('authenticates stdio bridge authority and leaves the companion available after a viewer disconnects', async () => {
  const f = await fixture();
  const socket = connect(f.path);

  await once(socket, 'connect');
  const received: unknown[] = [];

  const peer = new FramedPeer(socket, socket, (value) => {
    received.push(value);
  });

  await peer.send({
    capability: f.capability,
    origin: localTestOrigin,
    hello: {
      kind: 'hello',
      version: 1,
      requestId: 'hello-1',
      clientId: f.runtime.principal.clientId,
      handle: f.runtime.principal.handle,
    },
  });

  await expect.poll(() => received.length).toBe(2);
  expect(received[0]).toMatchObject({ kind: 'result', ok: true, data: { ownerId: 'owner-local' } });
  expect(received[1]).toMatchObject({ kind: 'event', frame: { type: 'snapshot' } });
  peer.close();
  await peer.closed;
  expect(f.runtime.monitor.session(f.runtime.session.id)).toBeDefined();
  const second = connect(f.path);

  await once(second, 'connect');
  second.destroy();
});

it('rejects a forged bridge capability without revealing any session data', async () => {
  const f = await fixture();
  const socket = connect(f.path);

  await once(socket, 'connect');
  const received: unknown[] = [];

  const peer = new FramedPeer(socket, socket, (value) => {
    received.push(value);
  });

  await peer.send({
    capability: 'wrong',
    origin: localTestOrigin,
    hello: { kind: 'hello', version: 1, requestId: 'bad', clientId: randomUUID() },
  });

  await peer.closed;
  expect(received).toEqual([]);
});

it('probes the private endpoint using its dedicated capability and rejects an impostor', async () => {
  const f = await fixture();

  expect(await probeCompanion(f.path, f.capability)).toMatchObject({ protocolVersion: 1 });
  await expect(probeCompanion(f.path, 'wrong')).rejects.toThrow('LOCAL_COMPANION_MISMATCH');
});
