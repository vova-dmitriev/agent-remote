import { ErrorCode, FrameType, HttpStatus } from '@protocol';
import { expect, it } from 'vitest';
import { createRelay } from '@server/app/create-relay.js';
import { databaseFixture } from '../../helpers/relay/database.js';
import { relaySocket } from '../../helpers/relay/attachment-relay.js';
import { initData, testBotToken } from '../../helpers/relay/telegram.js';

const operatorToken = 'synthetic-operator-token-'.padEnd(48, 'x');

async function relayWith(token: string | undefined) {
  const database = await databaseFixture();

  const relay = await createRelay({
    databaseUrl: database.url,
    schema: database.schema,
    botToken: testBotToken,
    publicOrigin: 'http://localhost',
    ...(token ? { operatorToken: token } : {}),
  });

  const origin = await relay.listen(0);

  const provision = async (bearer: string) => {
    const response = await fetch(`${origin}/operator/devices`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}` },
    });

    return { status: response.status, body: await response.json() };
  };

  return {
    relay,
    origin,
    provision,
    async close() {
      await relay.close();
      await database.close();
    },
  };
}

it("gives every user who opened the app a VM device once, only to the operator's token", async () => {
  const f = await relayWith(operatorToken);

  try {
    const first = await f.relay.auth.login(initData('510001'));

    expect((await f.provision('wrong-token')).body).toEqual({ code: ErrorCode.UNAUTHORIZED });
    expect((await f.provision(first.token)).body).toEqual({ code: ErrorCode.UNAUTHORIZED });

    const issued = await f.provision(operatorToken);

    expect(issued.status).toBe(HttpStatus.Ok);

    expect(issued.body.devices).toEqual([
      { ownerId: expect.any(String), deviceId: expect.any(String), deviceToken: expect.any(String) },
    ]);

    // The issued token authenticates that user's device; a second call issues nothing new.
    const [device] = issued.body.devices as { deviceToken: string }[];
    const socket = relaySocket(f.origin, '/ws/device', device!.deviceToken);

    await socket.next(FrameType.Authenticated);
    socket.socket.terminate();
    expect((await f.provision(operatorToken)).body).toEqual({ devices: [] });

    await f.relay.auth.login(initData('510002'));
    expect((await f.provision(operatorToken)).body.devices).toHaveLength(1);
  } finally {
    await f.close();
  }
});

it('has no operator endpoint when the relay runs without an operator token', async () => {
  const f = await relayWith(undefined);

  try {
    expect((await f.provision(operatorToken)).status).toBe(HttpStatus.NotFound);
  } finally {
    await f.close();
  }
});
