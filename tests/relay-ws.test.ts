import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { WebSocket } from 'ws';
import { Pool } from 'pg';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRelay } from '../apps/server/src/relay.js';
import { NotificationWorker } from '../apps/server/src/notifications/worker.js';
import { initData, testBotToken } from './helpers/telegram.js';
import type { Session, AppSnapshot, ServerFrame, ClientCommand } from '../packages/protocol/src/index.js';

const url =
    process.env.TEST_DATABASE_URL ??
    'postgres://claude_remote:local_test_only@127.0.0.1:55432/claude_remote_test',
  schema = 'ws_' + randomUUID().replaceAll('-', '');

let relay: Awaited<ReturnType<typeof createRelay>>,
  origin: string,
  tokenA: string,
  tokenB: string,
  deviceA: { deviceId: string; token: string },
  deviceB: { deviceId: string; token: string };

const sockets: WebSocket[] = [];
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function ws(path: string, token: string) {
  const socket = new WebSocket(origin.replace('http:', 'ws:') + path, { origin: 'http://127.0.0.1:4173' });

  sockets.push(socket);
  const frames: ServerFrame[] = [];

  const waiting: Array<{
    predicate: (frame: ServerFrame) => boolean;
    resolve: (value: ServerFrame) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token })));

  socket.on('message', (data) => {
    const frame = JSON.parse(String(data)) as ServerFrame;

    frames.push(frame);

    for (const waiter of [...waiting]) {
      if (waiter.predicate(frame)) {
        clearTimeout(waiter.timer);
        waiting.splice(waiting.indexOf(waiter), 1);
        waiter.resolve(frame);
      }
    }
  });

  socket.on('error', () => {});

  return {
    socket,
    frames,
    send: (value: unknown) => socket.send(JSON.stringify(value)),
    next: <T extends ServerFrame>(predicate: (frame: ServerFrame) => frame is T) =>
      new Promise<T>((resolve, reject) => {
        const existing = frames.find(predicate);

        if (existing) {
          resolve(existing);

          return;
        }

        const timer = setTimeout(() => reject(new Error('FRAME_TIMEOUT')), 3000);

        waiting.push({
          predicate,
          resolve: (frame) => {
            if (predicate(frame)) {
              resolve(frame);
            }
          },
          reject,
          timer,
        });
      }),
  };
}

async function pair(token: string) {
  const code = randomBytes(16).toString('hex'),
    proof = randomBytes(32).toString('hex');

  await relay.devices.start(sha(code), sha(proof));
  const claim = await relay.devices.claim(await relay.auth.authenticate(token), code);

  return (await relay.devices.confirm(proof, claim.claimId, true))!;
}

function session(deviceId: string): Session {
  return {
    id: 'same-local-session-id',
    target: { kind: 'claude-code-cli', deviceId, connectorId: 'native', claudeSessionId: 'same-claude-id' },
    claudeSessionId: 'same-claude-id',
    generation: 'generation',
    status: 'idle',
    binding: 'verified',
    lastEventAt: Date.now(),
    capabilities: {
      observe: true,
      history: true,
      prompt: true,
      interrupt: true,
      permission: true,
      terminalSnapshot: false,
    },
    integrationState: 'ready',
    statusConfidence: 'observed',
  };
}

function snapshot(s: Session): AppSnapshot {
  return {
    sessions: [s],
    cursor: { streamId: 'stream', seq: 0 },
    deviceStatus: 'online',
    permissions: [],
    terminal: null,
  };
}

beforeAll(async () => {
  const pool = new Pool({ connectionString: url });

  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.end();

  relay = await createRelay({
    databaseUrl: url,
    schema,
    botToken: testBotToken,
    publicOrigin: 'http://127.0.0.1:4173',
    inputEnabled: true,
    permissionsEnabled: true,
  });

  origin = await relay.listen(0);
  tokenA = (await relay.auth.login(initData('301'))).token;
  tokenB = (await relay.auth.login(initData('302'))).token;
  deviceA = await pair(tokenA);
  deviceB = await pair(tokenB);
}, 30000);

afterAll(async () => {
  sockets.forEach((socket) => socket.terminate());
  await relay?.close();
  const pool = new Pool({ connectionString: url });

  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.end();
});

describe('actual HTTP/WebSocket owner isolation and events', () => {
  it('routes live data and exactly one command to the selected owner device', async () => {
    const da = ws('/ws/device', deviceA.token),
      db = ws('/ws/device', deviceB.token),
      a = ws('/ws/app', tokenA),
      b = ws('/ws/app', tokenB);

    await Promise.all([
      da.next((f) => f.type === 'authenticated'),
      db.next((f) => f.type === 'authenticated'),
      a.next((f) => f.type === 'authenticated'),
      b.next((f) => f.type === 'authenticated'),
    ]);

    const sa = session(deviceA.deviceId),
      sb = session(deviceB.deviceId);

    da.send({ type: 'snapshot', snapshot: snapshot(sa), connectors: [] });
    db.send({ type: 'snapshot', snapshot: snapshot(sb), connectors: [] });
    a.send({ type: 'subscribe', deviceId: deviceA.deviceId, sessionId: null });
    b.send({ type: 'subscribe', deviceId: deviceA.deviceId, sessionId: null });
    expect((await b.next((f) => f.type === 'error')).code).toBe('NOT_FOUND');
    await a.next((f) => f.type === 'snapshot');

    const event = {
      version: 1,
      deviceId: deviceA.deviceId,
      streamId: 'stream',
      seq: 1,
      eventId: randomUUID(),
      sessionId: sa.id,
      occurredAt: Date.now(),
      type: 'message',
      payload: { id: 'm', role: 'assistant', text: '<script>alert(1)</script>', occurredAt: Date.now() },
    };

    da.send({ type: 'event', event });
    const payload = (await a.next((f) => f.type === 'event')).event.payload as { text: string };

    expect(payload.text).toBe('<script>alert(1)</script>');
    expect(b.frames.some((f) => f.type === 'event' || f.type === 'snapshot')).toBe(false);

    const command: ClientCommand = {
      commandId: randomUUID(),
      target: sa.target,
      sessionId: sa.id,
      generation: sa.generation,
      action: { type: 'prompt', text: 'hello' },
    };

    const p = await relay.auth.authenticate(tokenA);

    expect((await relay.command(p, command)).status).toBe('accepted');
    expect((await relay.command(p, command)).status).toBe('accepted');
    const delivered = await da.next((f) => f.type === 'command');

    expect(delivered.command.expiresAt - Date.now()).toBeLessThanOrEqual(15000);
    expect(da.frames.filter((f) => f.type === 'command')).toHaveLength(1);
    expect(db.frames.some((f) => f.type === 'command')).toBe(false);
    da.send({ type: 'command_result', result: { commandId: command.commandId, status: 'dispatched' } });
    expect((await a.next((f) => f.type === 'command_result')).result.status).toBe('dispatched');

    const foreign = await fetch(origin + '/sessions/' + sa.id + '/events', {
      headers: { authorization: 'Bearer ' + tokenB },
    });

    expect(foreign.status).toBe(200);
    expect(await foreign.json()).toEqual([]); // B owns its independent same ID, but no A event leaks.

    await expect(
      relay.replay(await relay.auth.authenticate(tokenB), deviceA.deviceId, { streamId: 'stream', seq: 0 }),
    ).rejects.toThrow('NOT_FOUND');
  });

  it('replacing a device socket fences its old epoch and revoke closes the new one', async () => {
    const first = ws('/ws/device', deviceA.token);

    await first.next((f) => f.type === 'authenticated');
    const next = ws('/ws/device', deviceA.token);

    await next.next((f) => f.type === 'authenticated');
    expect(relay.live.get(deviceA.deviceId)?.socket.readyState).toBe(WebSocket.OPEN);
    await relay.auth.authenticate(tokenA);

    const response = await fetch(origin + '/devices/' + deviceA.deviceId, {
      method: 'DELETE',
      headers: { authorization: 'Bearer ' + tokenA },
    });

    expect(response.status).toBe(200);
    expect(relay.live.has(deviceA.deviceId)).toBe(false);
    await expect(relay.devices.authenticate(deviceA.token)).rejects.toThrow('UNAUTHORIZED');
  });

  it('registers only private /start and notifies only its owner without prompt text', async () => {
    const calls: Array<{
      chat_id: string;
      text: string;
      reply_markup: { inline_keyboard: [[{ web_app: { url: string } }]] };
    }> = [];

    const fakeFetch: typeof fetch = async (_url, options) => {
      calls.push(JSON.parse(String(options?.body)));

      return Response.json({ ok: true, result: { message_id: 1 } });
    };

    const worker = new NotificationWorker(relay.db, testBotToken, 'https://example.invalid', fakeFetch);

    await worker.updates([
      { update_id: 1, message: { text: '/start', from: { id: 301 }, chat: { id: -10, type: 'group' } } },
    ]);

    await relay.notify(
      (await relay.auth.authenticate(tokenA)).userId,
      'test-before-start',
      'permission',
      'same-local-session-id',
    );

    await worker.deliver();
    expect(calls).toHaveLength(0);

    await worker.updates([
      { update_id: 2, message: { text: '/start', from: { id: 301 }, chat: { id: 301, type: 'private' } } },
    ]);

    await worker.deliver();
    expect(calls[0]?.chat_id).toBe('301');
    expect(calls[0]?.text).not.toContain('hello');
    expect(calls[0]?.reply_markup.inline_keyboard[0][0].web_app.url).toContain('session=');
    worker.close();
  });
});
