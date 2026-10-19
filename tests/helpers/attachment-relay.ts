import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { WebSocket } from 'ws';
import { createRelay } from '../../apps/server/src/app/create-relay.js';
import { hash } from '../../apps/server/src/auth/security.js';
import { sessionSchema, type ServerFrame, type Session } from '@protocol';
import { databaseFixture } from './database.js';
import { initData, testBotToken } from './telegram.js';

export function relaySocket(origin: string, path: string, token: string) {
  const socket = new WebSocket(origin.replace('http:', 'ws:') + path, { origin: 'http://localhost' });

  const frames: ServerFrame[] = [],
    pending: ServerFrame[] = [];

  const waiting: Array<{ type: ServerFrame['type']; resolve: (frame: ServerFrame) => void }> = [];

  socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token })));
  socket.on('error', () => {});

  socket.on('message', (raw) => {
    const frame = JSON.parse(String(raw)) as ServerFrame;

    frames.push(frame);
    const index = waiting.findIndex((waiter) => waiter.type === frame.type);

    if (index < 0) {
      pending.push(frame);
    } else {
      waiting.splice(index, 1)[0]!.resolve(frame);
    }
  });

  return {
    socket,
    frames,
    send: (frame: unknown) => socket.send(JSON.stringify(frame)),
    next<T extends ServerFrame['type']>(type: T) {
      return new Promise<Extract<ServerFrame, { type: T }>>((resolve, reject) => {
        const index = pending.findIndex((frame) => frame.type === type);

        if (index >= 0) {
          resolve(pending.splice(index, 1)[0] as Extract<ServerFrame, { type: T }>);

          return;
        }

        const waiter = {
          type,
          resolve: (frame: ServerFrame) => {
            clearTimeout(timer);
            resolve(frame as Extract<ServerFrame, { type: T }>);
          },
        };

        const timer = setTimeout(() => {
          waiting.splice(waiting.indexOf(waiter), 1);
          reject(new Error(`FRAME_TIMEOUT:${type}`));
        }, 3000);

        waiting.push(waiter);
      });
    },
  };
}

export async function attachmentRelayFixture(inputEnabled = true) {
  const database = await databaseFixture();

  const relay = await createRelay({
    databaseUrl: database.url,
    schema: database.schema,
    botToken: testBotToken,
    publicOrigin: 'http://localhost',
    inputEnabled,
  });

  const origin = await relay.listen(0);
  const token = (await relay.auth.login(initData('410001'))).token;
  const otherToken = (await relay.auth.login(initData('410002'))).token;
  const sockets: ReturnType<typeof relaySocket>[] = [];

  const seed = async (appToken = token, suffix = randomUUID()) => {
    const principal = await relay.auth.authenticate(appToken);

    const deviceId = `device-${suffix}`,
      deviceToken = `synthetic-token-${suffix}`;

    const session = sessionSchema.parse({
      id: `session-${suffix}`,
      generation: 'g1',
      target: { kind: 'codex-cli', deviceId, connectorId: 'c', threadId: 't' },
      claudeSessionId: null,
      status: 'idle',
      binding: 'verified',
      lastEventAt: 1,
      capabilities: {
        observe: true,
        history: true,
        prompt: true,
        interrupt: true,
        permission: true,
        terminalSnapshot: false,
        attachments: { images: 'native', files: 'reference' },
      },
      integrationState: 'ready',
      statusConfidence: 'observed',
    });

    await database.db.pool.query(
      'INSERT INTO devices(id,owner_id,token_hash,generation,snapshot) VALUES($1,$2,$3,$4,$5)',
      [deviceId, principal.userId, hash(deviceToken), 'device-generation', JSON.stringify(snapshot(session))],
    );

    await database.db.pool.query('INSERT INTO sessions(owner_id,device_id,id,data) VALUES($1,$2,$3,$4)', [
      principal.userId,
      deviceId,
      session.id,
      JSON.stringify(session),
    ]);

    return {
      principal,
      deviceId,
      deviceToken,
      session,
      context: { ownerId: principal.userId, deviceId, sessionId: session.id },
    };
  };

  const primary = await seed();

  const headers = (uploadId: string = randomUUID(), generation = primary.session.generation) => ({
    authorization: `Bearer ${token}`,
    'content-type': 'application/octet-stream',
    'x-upload-id': uploadId,
    'x-file-name': 'synthetic.bin',
    'x-session-generation': generation,
  });

  const path = `/sessions/${primary.session.id}/attachments`;

  return {
    ...primary,
    database,
    relay,
    origin,
    token,
    otherToken,
    seed,
    headers,
    path,
    upload: (bytes = Buffer.from('synthetic'), uploadId: string = randomUUID()) =>
      fetch(origin + path, { method: 'POST', headers: headers(uploadId), body: bytes }),
    connect(path: string, token: string) {
      const connection = relaySocket(origin, path, token);

      sockets.push(connection);

      return connection;
    },
    async publish(device: ReturnType<typeof relaySocket>, session: Session) {
      device.send({ type: 'snapshot', snapshot: snapshot(session), connectors: [] });
      const deadline = Date.now() + 3000;

      while (Date.now() < deadline) {
        const row = (
          await database.db.pool.query<{ data: Session }>(
            'SELECT data FROM sessions WHERE owner_id=$1 AND device_id=$2 AND id=$3',
            [primary.principal.userId, primary.deviceId, session.id],
          )
        ).rows[0];

        if (isDeepStrictEqual(row?.data, session)) {
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      throw new Error('SNAPSHOT_PERSIST_TIMEOUT');
    },
    async close() {
      sockets.forEach(({ socket }) => socket.terminate());
      await relay.close();
      await database.close();
    },
  };
}

function snapshot(session: Session) {
  return {
    sessions: [session],
    cursor: { streamId: 'synthetic-stream', seq: 0 },
    deviceStatus: 'online',
    permissions: [],
    terminal: null,
  };
}
