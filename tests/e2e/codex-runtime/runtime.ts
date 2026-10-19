import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { expect } from '@playwright/test';
import { startDaemon } from '../../../apps/daemon/src/main.js';
import { saveConfig, localSecret, socketPath } from '../../../apps/daemon/src/config.js';
import { requestLocal } from '../../../apps/daemon/src/code/hooks/ipc.js';
import { initData } from '../../helpers/telegram.js';
import type { ClientCommand } from '@protocol';
import { cliProvider } from './cli.js';
import { desktopProvider } from './desktop.js';
import type { Kind, Provider } from './model.js';
import { appOrigin } from '../runtime/app-origin.js';
import { startRelayProcess, type RemoteRelay } from '../support/relay-process.js';

const environmentNames = [
  'CLAUDE_REMOTE_HOME',
  'CODEX_HOME',
  'CLAUDE_CONFIG_DIR',
  'REMOTE_INPUT_ENABLED',
  'REMOTE_PERMISSIONS_ENABLED',
] as const;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export async function runtimeFixture(kind: Kind) {
  const directory = await mkdtemp('/tmp/cr-e2e-');
  const environment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));

  const url =
    process.env.TEST_DATABASE_URL ??
    'postgres://claude_remote:local_test_only@127.0.0.1:55432/claude_remote_test';

  const schema = 'codex_browser_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: url });
  let relay: RemoteRelay | undefined;
  let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
  let provider: Provider | undefined;

  const close = async () => {
    const results: PromiseSettledResult<unknown>[] = await Promise.allSettled([daemon?.close()]);

    results.push(...(await Promise.allSettled([provider?.close(), relay?.close()])));
    results.push(...(await Promise.allSettled([admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)])));

    results.push(
      ...(await Promise.allSettled([admin.end(), rm(directory, { recursive: true, force: true })])),
    );

    for (const name of environmentNames) {
      if (environment[name] === undefined) delete process.env[name];
      else process.env[name] = environment[name];
    }

    const failures = results.filter((result) => result.status === 'rejected');

    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        'CODEX_FIXTURE_CLEANUP_FAILED',
      );
  };

  try {
    await chmod(directory, 0o700);
    process.env.CLAUDE_REMOTE_HOME = join(directory, 'daemon');
    process.env.CODEX_HOME = join(directory, 'codex');
    process.env.CLAUDE_CONFIG_DIR = join(directory, 'claude');
    process.env.REMOTE_INPUT_ENABLED = '1';
    process.env.REMOTE_PERMISSIONS_ENABLED = '1';
    await mkdir(process.env.CODEX_HOME, { mode: 0o700 });
    await mkdir(process.env.CLAUDE_CONFIG_DIR, { mode: 0o700 });
    await admin.query(`CREATE SCHEMA ${schema}`);

    relay = await startRelayProcess({
      databaseUrl: url,
      schema,
      publicOrigin: appOrigin,
      port: 3000,
      inputEnabled: true,
      permissionsEnabled: true,
    });

    const login = await relay.auth.login(initData('801'));
    const principal = await relay.auth.authenticate(login.token);
    const code = randomBytes(16).toString('hex');
    const proof = randomBytes(32).toString('hex');

    await relay.devices.start(hash(code), hash(proof));
    const claim = await relay.devices.claim(principal, code);
    const device = (await relay.devices.confirm(proof, claim.claimId, true))!;

    await saveConfig({
      relayUrl: 'http://127.0.0.1:3000',
      deviceId: device.deviceId,
      deviceToken: device.token,
    });

    provider = await (kind === 'codex-cli' ? cliProvider : desktopProvider)(join(directory, 'provider.sock'));
    daemon = await startDaemon();

    const connect = async () => {
      provider!.resume();

      const response = await requestLocal(
        socketPath(),
        {
          type: 'codex_connect',
          token: await localSecret(),
          codex: { kind, socketPath: provider!.path, threadId: provider!.model.threadId },
        },
        60000,
      );

      expect(response).toMatchObject({ type: 'codex_result', result: { connected: 1, kind } });
    };

    await connect();
    await expect.poll(() => relay!.live.has(device.deviceId)).toBe(true);

    const current = () =>
      daemon!.monitor.snapshot().sessions.find((session) => session.target.kind === kind)!;

    await expect.poll(() => current()?.integrationState).toBe('ready');

    await expect
      .poll(async () => (await relay!.db.pool.query('SELECT count(*) FROM sessions')).rows[0].count)
      .toBe('1');

    const command = (action: ClientCommand['action'], commandId: string = randomUUID()): ClientCommand => {
      const session = current();

      return {
        commandId,
        sessionId: session.id,
        target: session.target,
        generation: session.generation,
        action,
      };
    };

    const audit = async () =>
      (
        await relay!.db.pool.query<{ command_id: string; status: string; code: string }>(
          'SELECT command_id,status,code FROM command_audit ORDER BY created_at',
        )
      ).rows;

    return { relay, daemon, provider, device, principal, login, connect, current, command, audit, close };
  } catch (error) {
    await close();

    throw error;
  }
}

export type Runtime = Awaited<ReturnType<typeof runtimeFixture>>;
