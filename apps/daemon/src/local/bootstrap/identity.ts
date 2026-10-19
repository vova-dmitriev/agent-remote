import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { ErrorCode } from '@protocol';
import { privateFile } from './private-file.js';

const schema = z.strictObject({
  ownerId: z.string().min(1).max(512),
  deviceId: z.string().min(1).max(512),
  instanceId: z.uuid(),
});

export async function loadLocalIdentity(directory: string, deviceId?: string) {
  const identity = schema.parse(
    JSON.parse(
      await privateFile(join(directory, 'local-identity.json'), () =>
        JSON.stringify({
          ownerId: 'local:' + randomUUID(),
          deviceId: deviceId ?? randomUUID(),
          instanceId: randomUUID(),
        }),
      ),
    ),
  );

  if (deviceId && identity.deviceId !== deviceId) {
    throw new Error(ErrorCode.LOCAL_COMPANION_MISMATCH);
  }

  return identity;
}

export async function localClientSecret(directory: string) {
  const secret = await privateFile(join(directory, 'local-client.key'), () =>
    randomBytes(32).toString('hex'),
  );

  if (!/^[a-f0-9]{64}$/.test(secret)) {
    throw new Error(ErrorCode.UNAUTHORIZED);
  }

  return secret;
}
