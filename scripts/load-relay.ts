import { Pool } from 'pg';
import { WebSocket } from 'ws';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { createRelay } from '@server/app/create-relay.js';
import { initData, testBotToken } from '../tests/helpers/telegram.js';
import type { Session, AppSnapshot, ServerFrame } from '@protocol';

const reportPrefix = process.env.LOAD_REPORT_PREFIX ?? 'load-relay';

if (!/^[a-z0-9-]+$/.test(reportPrefix)) {
  throw new Error('INVALID_REPORT_PREFIX');
}

const duration = Number(process.env.LOAD_SECONDS ?? 1800),
  url =
    process.env.TEST_DATABASE_URL ??
    'postgres://claude_remote:local_test_only@127.0.0.1:55432/claude_remote_test',
  schema = 'load_' + randomUUID().replaceAll('-', '');

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const admin = new Pool({ connectionString: url });

await admin.query(`CREATE SCHEMA ${schema}`);
await admin.end();

const relay = await createRelay({
  databaseUrl: url,
  schema,
  botToken: testBotToken,
  publicOrigin: 'http://127.0.0.1:4173',
});

const origin = await relay.listen(0),
  sockets: WebSocket[] = [],
  actors: Array<{
    device: WebSocket;
    app: WebSocket;
    deviceId: string;
    snapshot: AppSnapshot;
    token: string;
    telegramId: string;
  }> = [];

let received = 0,
  sent = 0,
  crossOwner = 0,
  errors = 0;

const latencyBounds = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, Infinity],
  latencies = latencyBounds.map(() => 0),
  memory: Array<{ seconds: number; rss: number; heap: number }> = [];

async function connection(path: string, token: string, onFrame: (frame: ServerFrame) => void) {
  const ws = new WebSocket(origin.replace('http:', 'ws:') + path, { origin: 'http://127.0.0.1:4173' });

  sockets.push(ws);

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
    ws.on('error', reject);

    ws.on('message', (raw) => {
      const frame = JSON.parse(String(raw)) as ServerFrame;

      if (frame.type === 'authenticated') {
        resolve();
      }

      onFrame(frame);
    });
  });

  return ws;
}

for (let i = 0; i < 20; i++) {
  const telegramId = String(90000 + i),
    token = (await relay.auth.login(initData(telegramId))).token,
    principal = await relay.auth.authenticate(token),
    code = randomBytes(16).toString('hex'),
    proof = randomBytes(32).toString('hex');

  await relay.devices.start(hash(code), hash(proof));

  const claim = await relay.devices.claim(principal, code),
    deviceInfo = (await relay.devices.confirm(proof, claim.claimId, true))!;

  const device = await connection('/ws/device', deviceInfo.token, (frame) => {
    if (frame.type === 'error') {
      errors++;
    }
  });

  const app = await connection('/ws/app', token, (frame) => {
    if (frame.type === 'event') {
      received++;

      if (frame.event.deviceId !== deviceInfo.deviceId) {
        crossOwner++;
      }

      const latency = Math.max(0, Date.now() - frame.event.occurredAt);
      const bucket = latencyBounds.findIndex((bound) => latency <= bound);

      latencies[bucket]!++;
    } else if (frame.type === 'error') {
      errors++;
    }
  });

  const sessions: Session[] = Array.from({ length: 10 }, (_, n) => ({
    id: 'session-' + n,
    target: {
      kind: 'claude-code-cli',
      deviceId: deviceInfo.deviceId,
      connectorId: 'native',
      claudeSessionId: 'claude-' + n,
    },
    claudeSessionId: 'claude-' + n,
    generation: 'g',
    status: 'idle',
    binding: 'verified',
    lastEventAt: Date.now(),
    capabilities: {
      observe: true,
      history: true,
      prompt: false,
      interrupt: false,
      permission: false,
      terminalSnapshot: n === 0,
    },
    integrationState: 'ready',
    statusConfidence: 'observed',
  }));

  const snapshot: AppSnapshot = {
    sessions,
    deviceStatus: 'online',
    cursor: { streamId: 'load', seq: 0 },
    permissions: [],
    terminal: {
      sessionId: 'session-0',
      generation: 'g',
      text: 'synthetic terminal fixture',
      capturedAt: Date.now(),
    },
  };

  device.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));

  // Wait for the independently connected device snapshot before selecting its session.
  while (!(await relay.devices.owned(principal, deviceInfo.deviceId)).snapshot) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  app.send(JSON.stringify({ type: 'subscribe', deviceId: deviceInfo.deviceId, sessionId: 'session-0' }));
  actors.push({ device, app, deviceId: deviceInfo.deviceId, snapshot, token, telegramId });
}

const started = Date.now();
let tick = 0;

const events = setInterval(() => {
  tick++;

  for (const actor of actors) {
    const event = {
      version: 1,
      deviceId: actor.deviceId,
      streamId: 'load',
      seq: ++actor.snapshot.cursor.seq,
      eventId: randomUUID(),
      sessionId: 'session-' + (tick % 10),
      occurredAt: Date.now(),
      type: 'status',
      payload: { status: 'running' },
    };

    if (actor.device.readyState === WebSocket.OPEN) {
      actor.device.send(JSON.stringify({ type: 'event', event }));
      sent++;
    }
  }
}, 100);

const snapshots = setInterval(() => {
  for (const actor of actors) {
    actor.snapshot.terminal!.capturedAt = Date.now();
    actor.device.send(JSON.stringify({ type: 'snapshot', snapshot: actor.snapshot, connectors: [] }));
  }
}, 1000);

const renewal = setInterval(() => {
  for (const actor of actors) {
    void relay.auth.login(initData(actor.telegramId)).then(async (login) => {
      actor.app.close();
      actor.token = login.token;

      actor.app = await connection('/ws/app', login.token, (frame) => {
        if (frame.type === 'event') {
          received++;

          if (frame.event.deviceId !== actor.deviceId) {
            crossOwner++;
          }

          const latency = Math.max(0, Date.now() - frame.event.occurredAt);

          latencies[latencyBounds.findIndex((bound) => latency <= bound)]!++;
        }
      });

      actor.app.send(JSON.stringify({ type: 'subscribe', deviceId: actor.deviceId, sessionId: 'session-0' }));
    });
  }
}, 780000);

const sample = setInterval(() => {
  const usage = process.memoryUsage();

  memory.push({ seconds: Math.round((Date.now() - started) / 1000), rss: usage.rss, heap: usage.heapUsed });

  void writeFile(
    'artifacts/' + reportPrefix + '-progress.json',
    JSON.stringify(
      {
        elapsedSeconds: Math.round((Date.now() - started) / 1000),
        targetSeconds: duration,
        owners: 20,
        sessions: 200,
        sent,
        received,
        crossOwner,
        errors,
        lastMemory: memory.at(-1),
      },
      null,
      2,
    ),
  ).catch(() => {});
}, 10000);

console.log(
  JSON.stringify({
    state: 'running',
    seconds: duration,
    owners: 20,
    sessions: 200,
    eventsPerSecond: 200,
    origin,
  }),
);

await new Promise((resolve) => setTimeout(resolve, duration * 1000));
clearInterval(events);
clearInterval(snapshots);
clearInterval(renewal);
clearInterval(sample);
await new Promise((resolve) => setTimeout(resolve, 1000));

let sum = 0,
  p95 = Infinity;

for (let i = 0; i < latencies.length; i++) {
  sum += latencies[i]!;

  if (sum >= received * 0.95) {
    p95 = latencyBounds[i]!;
    break;
  }
}

const retained = Number((await relay.db.pool.query('SELECT count(*) FROM events')).rows[0].count);

const report = {
  durationSeconds: duration,
  owners: 20,
  sessions: 200,
  sent,
  received,
  crossOwner,
  errors,
  p95UpperBoundMs: Number.isFinite(p95) ? p95 : null,
  retainedEvents: retained,
  memorySamples: memory,
  passed: crossOwner === 0 && errors === 0 && received >= sent * 0.98 && p95 <= 2000,
};

await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/' + reportPrefix + '.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, memorySamples: memory.length }));
sockets.forEach((socket) => socket.terminate());
await relay.close();
const cleanup = new Pool({ connectionString: url });

await cleanup.query(`DROP SCHEMA ${schema} CASCADE`);
await cleanup.end();

if (!report.passed) {
  process.exitCode = 1;
}
