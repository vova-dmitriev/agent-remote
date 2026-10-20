import { afterAll, beforeAll, expect, it } from 'vitest';
import { Database } from '@server/db/database.js';
import { createRelay } from '@server/app/create-relay.js';
import { databaseFixture } from '../../helpers/database.js';
import { initData, testBotToken } from '../../helpers/telegram.js';

let fixture: Awaited<ReturnType<typeof databaseFixture>>;
let relay: Awaited<ReturnType<typeof createRelay>>;
let origin: string;
let tokenA: string;
let tokenB: string;
const headers = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const read = (token: string) => fetch(origin + '/preferences', { headers: headers(token) });

const patch = (token: string, body: unknown) =>
  fetch(origin + '/preferences', {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  fixture = await databaseFixture();

  relay = await createRelay({
    databaseUrl: fixture.url,
    schema: fixture.schema,
    botToken: testBotToken,
    publicOrigin: 'http://localhost',
  });

  origin = await relay.listen(0);
  tokenA = (await relay.auth.login(initData('601'))).token;
  tokenB = (await relay.auth.login(initData('602'))).token;
});

afterAll(async () => {
  await relay?.close();
  await fixture?.close();
});

it('requires a user bearer and returns unset defaults without creating explicit choices', async () => {
  expect((await read('')).status).toBe(401);
  expect((await read('invalid')).status).toBe(401);
  expect(await (await read(tokenA)).json()).toEqual({ language: null, theme: null });
});

it('rejects invalid values and supplied identities without changing either field', async () => {
  for (const body of [
    {},
    { language: 'de' },
    { theme: 'system' },
    { theme: null },
    { language: 1 },
    { ownerId: 'other', theme: 'dark' },
  ]) {
    expect((await patch(tokenA, body)).status).toBe(400);
  }

  expect(await (await read(tokenA)).json()).toEqual({ language: null, theme: null });
});

it('isolates owners and preserves independent concurrent partial updates', async () => {
  const writes = await Promise.all([patch(tokenA, { language: 'en' }), patch(tokenA, { theme: 'dark' })]);

  expect(writes.map((response) => response.status)).toEqual([200, 200]);
  expect(await (await read(tokenA)).json()).toEqual({ language: 'en', theme: 'dark' });
  expect(await (await read(tokenB)).json()).toEqual({ language: null, theme: null });
  expect((await patch(tokenB, { theme: 'light' })).status).toBe(200);
});

it('persists choices across new auth sessions and a fresh PostgreSQL connection', async () => {
  await relay.auth.logout(tokenA);
  expect((await read(tokenA)).status).toBe(401);
  const token = (await relay.auth.login(initData('601'))).token;

  expect(await (await read(token)).json()).toEqual({ language: 'en', theme: 'dark' });
  const connection = new Database(fixture.url, fixture.schema);

  try {
    await connection.migrate();

    const saved = await connection.pool.query(
      'SELECT language,theme FROM user_preferences p JOIN users u ON u.id=p.owner_id WHERE u.telegram_id=$1',
      ['601'],
    );

    expect(saved.rows).toEqual([{ language: 'en', theme: 'dark' }]);
  } finally {
    await connection.close();
  }
});
