import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { connect, type Socket } from 'node:net';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, mkdir, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRelay } from '../../apps/server/src/relay.js';
import { startDaemon } from '../../apps/daemon/src/main.js';
import { saveConfig, localSecret, socketPath } from '../../apps/daemon/src/config.js';
import { requestLocal, lineReader, writeFrame } from '../../apps/daemon/src/code/hooks/ipc.js';
import type { AppSnapshot } from '@protocol';
import { initData, testBotToken } from '../helpers/telegram.js';

const url =
    process.env.TEST_DATABASE_URL ??
    'postgres://claude_remote:local_test_only@127.0.0.1:55432/claude_remote_test',
  schema = 'service_' + randomUUID().replaceAll('-', '');

let relay: Awaited<ReturnType<typeof createRelay>>,
  daemon: Awaited<ReturnType<typeof startDaemon>>,
  directory: string,
  origin: string,
  token: string,
  deviceId: string,
  key: string,
  wrapper: Socket;

let writes = 0;

const oldEnv = {
  home: process.env.CLAUDE_REMOTE_HOME,
  claude: process.env.CLAUDE_CONFIG_DIR,
  codex: process.env.CODEX_HOME,
  input: process.env.REMOTE_INPUT_ENABLED,
  permission: process.env.REMOTE_PERMISSIONS_ENABLED,
};

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

async function until<T>(read: () => Promise<T> | T, predicate: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5000;
  let value: T;

  do {
    value = await read();

    if (predicate(value)) {
      return value;
    }

    await new Promise((resolve) => setTimeout(resolve, 30));
  } while (Date.now() < deadline);

  throw new Error('CONDITION_TIMEOUT');
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'remote-service-'));
  process.env.CLAUDE_REMOTE_HOME = directory;
  process.env.CODEX_HOME = join(directory, 'isolated-codex');
  process.env.CLAUDE_CONFIG_DIR = join(directory, 'claude');
  process.env.REMOTE_INPUT_ENABLED = '1';
  process.env.REMOTE_PERMISSIONS_ENABLED = '1';
  await mkdir(process.env.CLAUDE_CONFIG_DIR);
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
  token = (await relay.auth.login(initData('701'))).token;

  const code = randomBytes(16).toString('hex'),
    proof = randomBytes(32).toString('hex');

  await relay.devices.start(sha(code), sha(proof));
  const claim = await relay.devices.claim(await relay.auth.authenticate(token), code);
  const device = (await relay.devices.confirm(proof, claim.claimId, true))!;

  deviceId = device.deviceId;
  await saveConfig({ relayUrl: origin, deviceId, deviceToken: device.token });
  key = await localSecret();
  daemon = await startDaemon();
  await until(() => relay.live.has(deviceId), Boolean);
}, 30000);

afterAll(async () => {
  wrapper?.destroy();
  await daemon?.close();
  await relay?.close();

  if (directory) {
    await rm(directory, { recursive: true, force: true });
  }

  for (const [key, value] of Object.entries(oldEnv)) {
    const name = {
      home: 'CLAUDE_REMOTE_HOME',
      claude: 'CLAUDE_CONFIG_DIR',
      codex: 'CODEX_HOME',
      input: 'REMOTE_INPUT_ENABLED',
      permission: 'REMOTE_PERMISSIONS_ENABLED',
    }[key]!;

    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  const pool = new Pool({ connectionString: url });

  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.end();
});

describe('complete relay <-> daemon <-> authenticated local hook/wrapper', () => {
  it('publishes actual JSONL text and forwards a prompt only once to its bound child', async () => {
    const wrapperId = randomUUID();

    wrapper = connect(socketPath());
    wrapper.on('error', () => {});

    await new Promise<void>((resolve) => {
      wrapper.on('connect', () => writeFrame(wrapper, { type: 'wrapper', token: key, wrapperId }));

      lineReader(wrapper, (value) => {
        const raw = value as
          { type: 'registered' } | { type: 'request'; id: string; action: { type: string } };

        if (raw.type === 'registered') {
          resolve();
        }

        if (raw.type === 'request') {
          if (raw.action.type === 'prompt') {
            writes++;
          }

          writeFrame(wrapper, { type: 'response', id: raw.id, result: { status: 'dispatched' } });
        }
      });
    });

    const transcript = join(process.env.CLAUDE_CONFIG_DIR!, 'fixture.jsonl');

    await writeFile(
      transcript,
      JSON.stringify({
        type: 'assistant',
        uuid: 'visible',
        timestamp: new Date().toISOString(),
        message: {
          content: [
            { type: 'thinking', thinking: 'must not leave Mac' },
            { type: 'text', text: 'Original context remains here' },
          ],
        },
      }) + '\n',
    );

    await requestLocal(socketPath(), {
      type: 'hook',
      token: key,
      wrapperId,
      payload: {
        hook_event_name: 'SessionStart',
        session_id: 'original-session',
        transcript_path: transcript,
      },
    });

    await requestLocal(socketPath(), {
      type: 'hook',
      token: key,
      wrapperId,
      payload: { hook_event_name: 'Stop', session_id: 'original-session' },
    });

    const principal = await relay.auth.authenticate(token);

    const snapshot = await until(
      async () => {
        const device = await relay.devices.owned(principal, deviceId);

        return device.snapshot as AppSnapshot;
      },
      (data) => data?.sessions?.[0]?.status === 'idle',
    );

    const session = snapshot.sessions[0]!;

    const response = await fetch(origin + '/sessions/' + encodeURIComponent(session.id) + '/events', {
      headers: { authorization: 'Bearer ' + token },
    });

    expect(response.ok).toBe(true);
    const history = await response.json();

    expect(JSON.stringify(history)).not.toContain('must not leave Mac');
    expect(JSON.stringify(history)).toContain('Original context remains here');

    const command = {
      commandId: randomUUID(),
      target: session.target,
      sessionId: session.id,
      generation: session.generation,
      action: { type: 'prompt' as const, text: 'Continue' },
    };

    await relay.command(principal, command);

    await until(
      () => writes,
      (value) => value === 1,
    );

    await relay.command(principal, command);
    expect(writes).toBe(1);
    expect((await stat(join(directory, 'device.json'))).mode & 0o777).toBe(0o600);
    expect((await stat(socketPath())).mode & 0o777).toBe(0o600);
  });

  it('resolves one live permission invocation and falls back locally on relay loss', async () => {
    const permission = requestLocal(socketPath(), {
      type: 'hook',
      token: key,
      payload: { hook_event_name: 'SessionStart', session_id: 'permission-session' },
    });

    await permission;

    const live = requestLocal(
      socketPath(),
      {
        type: 'hook',
        token: key,
        payload: {
          hook_event_name: 'PermissionRequest',
          session_id: 'permission-session',
          tool_name: 'Bash',
          tool_input: { command: 'pwd' },
        },
      },
      5000,
    );

    const principal = await relay.auth.authenticate(token);

    const snap = await until(
      async () => (await relay.devices.owned(principal, deviceId)).snapshot as AppSnapshot,
      (data) => data?.permissions?.length === 1,
    );

    const pending = snap.permissions[0]!,
      session = snap.sessions.find((s) => s.id === pending.sessionId)!;

    await relay.command(principal, {
      commandId: randomUUID(),
      target: session.target,
      sessionId: session.id,
      generation: session.generation,
      action: { type: 'permission', requestId: pending.requestId, decision: 'allow' },
    });

    expect((await live).output).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });

    const fallback = requestLocal(
      socketPath(),
      {
        type: 'hook',
        token: key,
        payload: {
          hook_event_name: 'PermissionRequest',
          session_id: 'permission-session',
          tool_name: 'Bash',
          tool_input: { command: 'pwd' },
        },
      },
      5000,
    );

    await until(
      () => daemon.monitor.snapshot().permissions.length,
      (n) => n === 1,
    );

    relay.live.get(deviceId)!.socket.terminate();
    expect((await fallback).output).toEqual({});
  });
});
