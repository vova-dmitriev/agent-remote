import { join, resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { RuntimeProfiles } from '../../../apps/daemon/src/runtime/services/runtime-profiles.js';
import type { localFixture } from '../../helpers/local-runtime.js';

export async function localProfileFixture(local: ReturnType<typeof localFixture>, directory: string) {
  const settings = join(directory, 'profile-native-settings.json');

  await writeFile(settings, '{}');

  const runtime = new RuntimeProfiles({
    database: local.database,
    directory,
    scope: { ownerId: local.principal.ownerId, deviceId: local.principal.deviceId },
    inputEnabled: true,
    baseEnvironment: {},
    native: {
      executable: process.execPath,
      prefixArguments: [resolve('tests/profiles/native-peer.mjs'), settings],
      apiFetch: async () => Response.json({ data: [{ id: 'synthetic-model' }] }),
    },
  });

  local.controller.options.profiles = runtime;
  const recipient = await runtime.request({ kind: 'recipient' });

  if (recipient.kind !== 'recipient') {
    throw new Error('SYNTHETIC_RECIPIENT_MISSING');
  }

  return { runtime, pin: recipient.data.recipientKeyId };
}
