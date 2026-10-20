import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { databaseFixture } from '../../helpers/relay/database.js';
import { createRelay } from '@server/app/create-relay.js';
import { testBotToken } from '../../helpers/relay/telegram.js';

it('closes its PostgreSQL connections when Redis initialization fails', async () => {
  const fixture = await databaseFixture();
  const server = createServer();

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('NO_PORT');
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));
  const name = 'failed-' + randomUUID();
  const url = new URL(fixture.url);

  url.searchParams.set('application_name', name);

  try {
    await expect(
      createRelay({
        databaseUrl: url.href,
        schema: fixture.schema,
        redisUrl: `redis://127.0.0.1:${address.port}`,
        botToken: testBotToken,
        publicOrigin: 'http://127.0.0.1:4173',
      }),
    ).rejects.toThrow('REDIS_UNAVAILABLE');

    await expect
      .poll(async () =>
        Number(
          (
            await fixture.db.pool.query('SELECT count(*) FROM pg_stat_activity WHERE application_name=$1', [
              name,
            ])
          ).rows[0].count,
        ),
      )
      .toBe(0);
  } finally {
    await fixture.close();
  }
});
