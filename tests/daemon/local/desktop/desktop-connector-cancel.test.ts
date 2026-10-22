import { afterEach, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalDatabase } from '@daemon/local/state/database.js';
import { LocalGrants } from '@daemon/local/grants/service.js';
import { startLocalServer } from '@daemon/local/server/server.js';
import { LocalOrigin } from '@protocol';
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
  'leaves the desktop grant pending when native approval is cancelled',
  async () => {
    const packaged = await desktopRuntimeFixture();
    const userData = join(packaged.root, 'user data');
    const directory = join(userData, 'desktop-companion');

    await mkdir(directory, { recursive: true, mode: 0o700 });
    const identity = { ownerId: 'owner-local', deviceId: 'device-local', instanceId: randomUUID() };

    await writeFile(join(directory, 'local-identity.json'), JSON.stringify(identity), { mode: 0o600 });
    const capability = randomBytes(32).toString('hex');

    await writeFile(join(directory, 'local-client.key'), capability, { mode: 0o600 });
    const database = new LocalDatabase(join(directory, 'local-client.sqlite'));
    const grants = new LocalGrants(database, 'owner-local', 'device-local', []);
    const fixture = localFixture();

    fixture.controller.options.grants = grants;

    const server = await startLocalServer({
      path: join(directory, 'client.sock'),
      capability,
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

    await expect(
      createDesktopCompanionConnector({
        verifiedResourceRoot: packaged.resourceRoot,
        privateUserDataRoot: userData,
        platform: process.platform,
        architecture: process.arch,
        appVersion: '0.1.0',
        confirmLocalAccess: async () => false,
      }),
    ).rejects.toThrow('LOCAL_APPROVAL_REQUIRED');

    expect(grants.pending()).toEqual([{ clientId: identity.instanceId, origin: LocalOrigin.Desktop }]);
  },
  60_000,
);
