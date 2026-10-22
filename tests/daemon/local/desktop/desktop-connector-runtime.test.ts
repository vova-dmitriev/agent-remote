import { afterEach, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalDatabase } from '@daemon/local/state/database.js';
import { LocalGrants } from '@daemon/local/grants/service.js';
import { startLocalServer } from '@daemon/local/server/server.js';
import { LocalOperation, LocalOrigin } from '@protocol';
import { createDesktopCompanionConnector } from '@desktop/runtime/connector.js';
import { desktopRuntimeFixture } from '../../../helpers/desktop/desktop-runtime-fixture.js';
import { localFixture } from '../../../helpers/local/local-runtime.js';
import { guardRuntimeProcesses } from '../../../helpers/desktop/runtime-processes.js';

const cleanups: Array<() => Promise<unknown>> = [];
const itOnDarwin = it.skipIf(process.platform !== 'darwin');

guardRuntimeProcesses();

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

itOnDarwin(
  'uses standalone verified runtime, confirms desktop approval, proves transport, and reopens without another prompt',
  async () => {
    const packaged = await desktopRuntimeFixture();
    const userData = join(packaged.root, 'user data with spaces');
    const directory = join(userData, 'desktop-companion');
    const ownerId = 'owner-local';
    const deviceId = 'device-local';
    const identity = { ownerId, deviceId, instanceId: randomUUID() };

    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, 'local-identity.json'), JSON.stringify(identity), { mode: 0o600 });
    await writeFile(join(directory, 'local-client.key'), randomBytes(32).toString('hex'), { mode: 0o600 });

    const database = new LocalDatabase(join(directory, 'local-client.sqlite'));
    const grants = new LocalGrants(database, ownerId, deviceId, []);
    const fixture = localFixture();

    fixture.controller.options.grants = grants;

    const server = await startLocalServer({
      path: join(directory, 'client.sock'),
      capability: await readFile(join(directory, 'local-client.key'), 'utf8'),
      controller: fixture.controller,
      grants,
    });

    cleanups.push(
      () => packaged.close(),
      () => rm(userData, { recursive: true, force: true }),
      async () => {
        await server.close();
        database.close();
        await fixture.close();
      },
    );

    let confirmations = 0;

    const options = {
      verifiedResourceRoot: packaged.resourceRoot,
      privateUserDataRoot: userData,
      platform: process.platform,
      architecture: process.arch,
      appVersion: '0.1.0',
      confirmLocalAccess: async () => {
        confirmations++;

        return true;
      },
    };

    const connector = await createDesktopCompanionConnector(options, {
      approveDesktopGrant: async (_node, _entry, _directory, clientId) =>
        grants.approve(clientId, LocalOrigin.Desktop),
    });

    const frames: unknown[] = [];
    const unsubscribe = connector.subscribe((frame) => frames.push(frame));

    await expect.poll(() => frames.length).toBeGreaterThan(0);

    await expect(connector.request({ operation: LocalOperation.Devices })).resolves.toEqual([
      { id: deviceId, last_seen_at: expect.any(String) },
    ]);

    expect(confirmations).toBe(1);
    unsubscribe();
    await connector.close();

    const reopened = await createDesktopCompanionConnector(options);

    await expect(reopened.request({ operation: LocalOperation.Devices })).resolves.toHaveLength(1);
    expect(confirmations).toBe(1);
    await reopened.close();
  },
  60_000,
);
