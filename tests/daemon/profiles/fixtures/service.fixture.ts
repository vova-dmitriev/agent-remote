import { ProfileService } from '@daemon/profiles/service.js';
import type { ProfileServiceOptions } from '@daemon/profiles/lifecycle/types.js';
import { profileRegistryFixture } from './registry.fixture.js';

export function profileServiceFixture(cleanup?: ProfileServiceOptions['cleanup']) {
  const { database, directory } = profileRegistryFixture();

  const options = {
    database: database(),
    directory,
    scope: { ownerId: 'owner-a', deviceId: 'mac-a' },
    ...(cleanup ? { cleanup } : {}),
  };

  return { directory, options, service: new ProfileService(options) };
}
