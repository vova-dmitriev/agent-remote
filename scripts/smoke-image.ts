import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { HttpStatus } from '@protocol';
import { initData, testBotToken } from '../tests/helpers/relay/telegram.js';

const url =
  process.env.TEST_DATABASE_URL ??
  'postgres://claude_remote:local_test_only@127.0.0.1:55432/claude_remote_test';

const schema = 'image_' + randomUUID().replaceAll('-', '');
const container = 'claude-remote-smoke-' + randomUUID().slice(0, 8);
const db = new Pool({ connectionString: url });
const sockets: WebSocket[] = [];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

const run = (...args: string[]) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function until(read: () => Promise<boolean>, timeout = 15000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (await read().catch(() => false)) {
      return;
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error('IMAGE_SMOKE_TIMEOUT');
}

try {
  await db.query(`CREATE SCHEMA ${schema}`);
  const module = `import {createRelay} from './dist/apps/server/src/app/create-relay.js';const relay=await createRelay({databaseUrl:process.env.SMOKE_DATABASE_URL,schema:process.env.SMOKE_SCHEMA,redisUrl:process.env.SMOKE_REDIS_URL,botToken:process.env.SMOKE_BOT_TOKEN,publicOrigin:'http://127.0.0.1:4173',staticDirectory:'/app/dist/mini-app'});await relay.listen(3000,'0.0.0.0');`;
  const dockerUrl = new URL(url);

  dockerUrl.hostname = 'host.docker.internal';
  const redisUrl = new URL(process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56380');

  redisUrl.hostname = 'host.docker.internal';

  run(
    'run',
    '-d',
    '--name',
    container,
    '-p',
    '127.0.0.1::3000',
    '-e',
    'SMOKE_DATABASE_URL=' + dockerUrl.href,
    '-e',
    'SMOKE_SCHEMA=' + schema,
    '-e',
    'SMOKE_REDIS_URL=' + redisUrl.href,
    '-e',
    'SMOKE_BOT_TOKEN=' + testBotToken,
    'claude-remote:local-test',
    'node',
    '--input-type=module',
    '-e',
    module,
  );

  const port = run('port', container, '3000/tcp').split(':').at(-1)!;
  const origin = 'http://127.0.0.1:' + port;

  await until(async () => (await fetch(origin + '/health')).ok);
  const root = await fetch(origin);

  if (!root.ok || !(await root.text()).includes('<div id="root">')) {
    throw new Error('IMAGE_STATIC_FAILED');
  }

  async function request<T>(path: string, body: unknown, token?: string) {
    const response = await fetch(origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error('IMAGE_HTTP_' + response.status);
    }

    return response.json() as Promise<T>;
  }

  const a = await request<{ token: string }>('/auth/telegram', { initData: initData('990001') });
  const b = await request<{ token: string }>('/auth/telegram', { initData: initData('990002') });

  const code = randomBytes(16).toString('hex'),
    proof = randomBytes(32).toString('hex');

  await request('/device/pair/start', { codeHash: hash(code), proofHash: hash(proof) });
  const claim = await request<{ claimId: string }>('/pair/claim', { code }, a.token);

  const device = await request<{ deviceId: string; token: string }>('/device/pair/confirm', {
    proof,
    claimId: claim.claimId,
    approved: true,
  });

  const foreign = await fetch(origin + '/devices/' + device.deviceId + '/snapshot', {
    headers: { authorization: 'Bearer ' + b.token },
  });

  if (foreign.status !== HttpStatus.NotFound) {
    throw new Error('IMAGE_OWNER_ISOLATION_FAILED');
  }

  const socket = new WebSocket(origin.replace('http:', 'ws:') + '/ws/device');

  sockets.push(socket);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('IMAGE_WS_TIMEOUT')), 5000);

    socket.on('error', reject);
    socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token: device.token })));

    socket.on('message', (raw) => {
      if (JSON.parse(String(raw)).type === 'authenticated') {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  const report = {
    image: 'claude-remote:local-test',
    health: true,
    staticApp: true,
    telegramAuth: true,
    pairing: true,
    ownerIsolation: true,
    deviceWebSocket: true,
    redis: true,
    passed: true,
  };

  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/docker-smoke.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  try {
    console.error(execFileSync('docker', ['logs', container], { encoding: 'utf8' }).slice(-6000));
  } catch {}

  throw error;
} finally {
  sockets.forEach((socket) => socket.terminate());

  try {
    run('stop', '-t', '2', container);
    run('rm', container);
  } catch {}

  await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await db.end();
}
