import { ErrorCode, FrameType, SocketCloseCode, SocketCloseReason } from '@protocol';
import { once } from 'node:events';
import { chmod, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { readRelayStatus, saveRelayStatus } from '../apps/daemon/src/diagnostics/relay-status.js';
import { startDaemon } from '../apps/daemon/src/main.js';
import { runCli } from '../apps/daemon/src/setup-cli.js';

const STATUS_FILE = 'relay-status.json';
/** A pid no live process uses on the test machine (beyond the default pid range). */
const DEAD_PID = 2 ** 22 + 1;

const cleanups: Array<() => Promise<unknown> | unknown> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }

  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A stub relay; `onAuth` decides what each device connection gets after its `Auth` frame. */
async function stubRelay(onAuth: (socket: WebSocket) => void) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });

  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  server.on('connection', (socket) => socket.once('message', () => onAuth(socket)));
  await once(server, 'listening');

  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

/** A companion home whose device points at `relayUrl`. */
async function home(relayUrl: string) {
  const root = await mkdtemp(join(tmpdir(), 'relay-status-'));

  cleanups.push(() => rm(root, { recursive: true, force: true }));

  await writeFile(
    join(root, 'device.json'),
    JSON.stringify({ relayUrl, deviceId: 'device', deviceToken: 'token' }),
    {
      mode: 0o600,
    },
  );

  vi.stubEnv('CLAUDE_REMOTE_HOME', root);
  vi.stubEnv('CLAUDE_CONFIG_DIR', root);
  vi.stubEnv('CODEX_HOME', join(root, 'isolated-codex'));

  return root;
}

async function writeRecord(root: string, record: unknown) {
  await writeFile(join(root, STATUS_FILE), JSON.stringify(record), { mode: 0o600 });
}

async function start() {
  const daemon = await startDaemon();

  cleanups.push(() => daemon.close());

  return daemon;
}

async function statusOutput() {
  const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

  try {
    await runCli(['status']);

    return JSON.parse(String(write.mock.calls.at(-1)![0])) as Record<string, unknown>;
  } finally {
    write.mockRestore();
  }
}

it('clears an earlier record at start and clears a new one once the relay authenticates', async () => {
  let authenticate = () => {};

  const relayUrl = await stubRelay((socket) => {
    authenticate = () => socket.send(JSON.stringify({ type: FrameType.Authenticated, epoch: 'epoch' }));
  });

  const root = await home(relayUrl);

  await writeRecord(root, { code: ErrorCode.PROTOCOL_UNSUPPORTED, at: 1, pid: process.pid });
  await start();
  expect(await readRelayStatus(root)).toBeUndefined();

  await saveRelayStatus(root, ErrorCode.PROTOCOL_UNSUPPORTED);
  await expect.poll(() => readRelayStatus(root)).toBeDefined();
  authenticate();
  await expect.poll(() => readRelayStatus(root)).toBeUndefined();
});

it('records PROTOCOL_UNSUPPORTED with this pid at mode 0600, shows it in status and clears it on a clean stop', async () => {
  const relayUrl = await stubRelay((socket) => {
    socket.send(JSON.stringify({ type: FrameType.Error, code: ErrorCode.PROTOCOL_UNSUPPORTED }));
    socket.close(SocketCloseCode.ProtocolUnsupported, SocketCloseReason.ProtocolUnsupported);
  });

  const root = await home(relayUrl);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const daemon = await start();

  await expect
    .poll(() => readRelayStatus(root))
    .toMatchObject({ code: ErrorCode.PROTOCOL_UNSUPPORTED, pid: process.pid, at: expect.any(Number) });

  stderr.mockRestore();
  expect((await stat(join(root, STATUS_FILE))).mode & 0o777).toBe(0o600);
  expect(await statusOutput()).toMatchObject({ relayStatus: ErrorCode.PROTOCOL_UNSUPPORTED });

  await daemon.close();
  expect(await readRelayStatus(root)).toBeUndefined();
});

it('leaves out a record whose companion no longer runs, and never reads a foreign or exposed file', async () => {
  const root = await home('http://127.0.0.1:9');

  await writeRecord(root, { code: ErrorCode.PROTOCOL_UNSUPPORTED, at: 1, pid: DEAD_PID });
  expect(await readRelayStatus(root)).toMatchObject({ pid: DEAD_PID });
  expect(await statusOutput()).not.toHaveProperty('relayStatus');

  await chmod(join(root, STATUS_FILE), 0o644);
  expect(await readRelayStatus(root)).toBeUndefined();

  await rm(join(root, STATUS_FILE));

  await writeFile(
    join(root, 'elsewhere.json'),
    JSON.stringify({ code: ErrorCode.PROTOCOL_UNSUPPORTED, at: 1, pid: process.pid }),
    {
      mode: 0o600,
    },
  );

  await symlink(join(root, 'elsewhere.json'), join(root, STATUS_FILE));
  expect(await readRelayStatus(root)).toBeUndefined();
});
