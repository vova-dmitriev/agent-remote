import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { LocalDatabase } from '../../apps/daemon/src/local/state/database.js';
import { LocalGrants } from '../../apps/daemon/src/local/grants/service.js';
import { runtimeConfiguration } from '../../apps/daemon/src/local/bootstrap/configuration.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export async function createBrowserFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "browser cli ' ; $() ")));
  const directory = join(root, 'private state');
  const packaged = join(root, 'packaged runtime');

  await mkdir(directory, { mode: 0o700 });
  await mkdir(join(packaged, 'runtime'), { recursive: true, mode: 0o700 });
  const node = '#!/bin/sh\nprintf "%s\\n" "$@" > "$CLAUDE_REMOTE_HOME/fixture-args"\n';
  const entry = 'synthetic entry';

  await writeFile(join(packaged, 'runtime/node'), node, { mode: 0o700 });
  await writeFile(join(packaged, 'entry.mjs'), entry, { mode: 0o600 });

  await writeFile(
    join(packaged, 'runtime-manifest.json'),
    JSON.stringify({
      runtime: {
        nodePath: 'runtime/node',
        entryPath: 'entry.mjs',
        nodeSha256: digest(node),
        entrySha256: digest(entry),
      },
    }),
  );

  const output = new PassThrough();
  const printed = { text: '' };

  output.on('data', (data) => {
    printed.text += data.toString();
  });

  return { root, directory, packaged, output, printed };
}

export async function cleanupBrowserFixture(root: string, previousInput: string | undefined) {
  if (previousInput === undefined) {
    delete process.env.REMOTE_INPUT_ENABLED;
  } else {
    process.env.REMOTE_INPUT_ENABLED = previousInput;
  }

  await rm(root, { recursive: true, force: true });
}

export async function pendingGrant(directory: string, origin: string) {
  const identity = await runtimeConfiguration(directory);
  const database = new LocalDatabase(join(directory, 'local-client.sqlite'));
  const grants = new LocalGrants(database, identity.ownerId, identity.deviceId, [origin]);
  const clientId = randomUUID();

  try {
    grants.connect(origin, clientId);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'LOCAL_APPROVAL_REQUIRED') {
      database.close();
      throw error;
    }
  }

  return { database, grants, clientId };
}
