import { expect, it } from 'vitest';
import { databaseFixture } from '../../helpers/database.js';
import { ProfileMetadataCache } from '@server/profiles/repository.js';

it('persists only strict safe metadata and fences cached reads by owner, device and revocation', async () => {
  const fixture = await databaseFixture();

  try {
    await fixture.db.pool.query(
      "INSERT INTO users(id,telegram_id,created_at) VALUES('owner','9881',0),('foreign','9882',0)",
    );

    await fixture.db.pool.query(
      "INSERT INTO devices(id,owner_id,token_hash,generation) VALUES('mac','owner','synthetic-cache-token-hash','generation')",
    );

    const cache = new ProfileMetadataCache(fixture.db);

    const data = {
      available: true,
      observedAt: 123,
      profiles: [],
      operations: [],
      defaults: { claude: null, codex: null },
    };

    await cache.save('owner', 'mac', 'generation', data);
    expect(await cache.read('owner', 'mac')).toEqual({ ...data, available: false });
    await expect(cache.read('foreign', 'mac')).rejects.toThrow(/^NOT_FOUND$/);
    await expect(cache.save('foreign', 'mac', 'generation', data)).rejects.toThrow(/^NOT_FOUND$/);

    await expect(
      cache.save('owner', 'mac', 'generation', {
        ...data,
        apiKey: 'synthetic-private-cache-credential',
      } as never),
    ).rejects.toThrow();

    expect(
      JSON.stringify((await fixture.db.pool.query('SELECT data FROM execution_profile_metadata')).rows),
    ).not.toContain('synthetic-private-cache-credential');

    await fixture.db.pool.query("UPDATE devices SET revoked_at=1 WHERE id='mac'");
    await expect(cache.read('owner', 'mac')).rejects.toThrow(/^NOT_FOUND$/);
  } finally {
    await fixture.close();
  }
});
