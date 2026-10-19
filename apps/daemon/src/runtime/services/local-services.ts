import { join } from 'node:path';
import type { Session } from '@protocol';
import { LocalDatabase } from '../../local/state/database.js';
import { LocalDocuments } from '../../local/state/documents.js';
import { LocalGrants } from '../../local/grants/service.js';
import { LocalMediaRepository } from '../../local/media/repository.js';
import { browserSettings } from '../../local/bootstrap/configuration.js';
import { RuntimeProfiles } from './runtime-profiles.js';
import type { RuntimeProfileConfiguration } from '../../profiles/runtime/types.js';

export async function openLocalServices(
  identity: { ownerId: string; deviceId: string },
  directory: string,
  session: (id: string) => Session | undefined,
  profileOptions?: RuntimeProfileConfiguration,
) {
  const database = new LocalDatabase(join(directory, 'local-client.sqlite'));
  const settings = await browserSettings(directory);
  const grants = new LocalGrants(database, identity.ownerId, identity.deviceId, settings?.origins ?? []);
  const documents = new LocalDocuments(database);

  const media = new LocalMediaRepository({
    directory,
    database,
    ownerId: identity.ownerId,
    session,
    current: (principal) => grants.current(principal),
  });

  const profiles = new RuntimeProfiles({
    database,
    directory,
    scope: { ownerId: identity.ownerId, deviceId: identity.deviceId },
    inputEnabled: profileOptions?.inputEnabled ?? false,
    baseEnvironment: profileOptions?.baseEnvironment ?? {},
    native: profileOptions?.native ?? { executable: 'codex' },
  });

  return { database, grants, documents, media, profiles };
}

export type LocalServices = Awaited<ReturnType<typeof openLocalServices>>;
