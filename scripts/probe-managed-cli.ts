import { Pool } from 'pg';
import { spawn, type IPty } from 'node-pty';
import { mkdtemp, mkdir, rm, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';
import { createRelay } from '../apps/server/src/relay.js';
import { startDaemon } from '../apps/daemon/src/main.js';
import { saveConfig } from '../apps/daemon/src/config.js';
import { installHooks } from '../apps/daemon/src/code/hooks/install-hooks.js';
import { initData, testBotToken } from '../tests/helpers/telegram.js';

const url =
    process.env.TEST_DATABASE_URL ??
    'postgres://claude_remote:local_test_only@127.0.0.1:55432/claude_remote_test',
  schema = 'probe_' + randomUUID().replaceAll('-', ''),
  directory = await mkdtemp(join(tmpdir(), 'remote-native-'));

let relay: Awaited<ReturnType<typeof createRelay>> | undefined,
  daemon: Awaited<ReturnType<typeof startDaemon>> | undefined,
  child: IPty | undefined;

let text = '',
  trusted = false;

const report: Record<string, unknown> = { localTurn: false, remoteTurn: false, permission: false };

async function until(predicate: () => boolean | Promise<boolean>, timeout = 45000) {
  const end = Date.now() + timeout;

  while (Date.now() < end) {
    if (await predicate()) {
      return;
    }

    if (!trusted && /trust\s*(?:this|the)\s*folder|Yes,?\s*I\s*trust/i.test(text)) {
      trusted = true;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      child?.write('\x1b[B');
      await new Promise((resolve) => setTimeout(resolve, 200));
      child?.write('\r');
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('PROBE_TIMEOUT');
}

async function assistantSeen(value: string) {
  if (!relay) {
    return false;
  }

  const rows = await relay.db.pool.query(
    "SELECT data FROM events WHERE data->>'type'='message' AND data->'payload'->>'role'='assistant' AND data->'payload'->>'text'=$1",
    [value],
  );

  return rows.rowCount! > 0;
}

const digest = (s: string) => createHash('sha256').update(s).digest('hex');

try {
  await mkdir(join(directory, 'home'));
  await mkdir(join(directory, 'project'));
  process.env.CLAUDE_REMOTE_HOME = join(directory, 'home');
  // This probe owns Claude only; never discover the user's active Codex conversations.
  process.env.CODEX_HOME = join(directory, 'codex');
  await mkdir(process.env.CODEX_HOME, { mode: 0o700 });
  process.env.REMOTE_INPUT_ENABLED = '1';
  process.env.REMOTE_PERMISSIONS_ENABLED = '1';
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

  const origin = await relay.listen(0),
    login = await relay.auth.login(initData('999001')),
    principal = await relay.auth.authenticate(login.token),
    code = randomBytes(16).toString('hex'),
    proof = randomBytes(32).toString('hex');

  await relay.devices.start(digest(code), digest(proof));

  const claim = await relay.devices.claim(principal, code),
    device = (await relay.devices.confirm(proof, claim.claimId, true))!;

  await saveConfig({ relayUrl: origin, deviceId: device.deviceId, deviceToken: device.token });
  daemon = await startDaemon();
  const settings = join(directory, 'settings.json');

  await writeFile(settings, JSON.stringify({ permissions: { ask: ['Bash'] } }));
  await installHooks(settings, resolve('apps/daemon/bin/remote.mjs'));

  child = spawn(process.execPath, [resolve('apps/daemon/bin/remote.mjs'), 'claude', '--settings', settings], {
    cwd: join(directory, 'project'),
    env: { ...process.env },
    cols: 120,
    rows: 40,
    name: 'xterm-256color',
  });

  child.onExit((event) => {
    report.exitCode = event.exitCode;
  });

  child.onData((data) => {
    void appendFile('.superpowers/managed-cli-raw.txt', data, { mode: 0o600 });
    text = (text + stripVTControlCharacters(data)).slice(-200000);
    void writeFile('.superpowers/managed-cli-output.txt', text, { mode: 0o600 });
  });

  await until(() => trusted, 10000);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  child.write('Reply with exactly LOCAL_READY. Do not use tools.\r');

  await until(
    async () =>
      daemon!.monitor.snapshot().sessions[0]?.status === 'idle' && (await assistantSeen('LOCAL_READY')),
    60000,
  );

  report.localTurn = true;
  const session = daemon.monitor.snapshot().sessions[0]!;
  const before = session.lastEventAt;

  await relay.command(principal, {
    commandId: randomUUID(),
    target: session.target,
    sessionId: session.id,
    generation: session.generation,
    action: { type: 'prompt', text: 'Reply with exactly REMOTE_READY. Do not use tools.' },
  });

  await until(
    async () =>
      (daemon!.monitor.snapshot().sessions[0]?.lastEventAt ?? -Infinity) > before &&
      daemon!.monitor.snapshot().sessions[0]?.status === 'idle' &&
      (await assistantSeen('REMOTE_READY')),
    60000,
  );

  report.remoteTurn = true;
  child.write('Use the Bash tool to run pwd, then reply PERMISSION_READY.\r');
  await until(() => daemon!.monitor.snapshot().permissions.length === 1, 60000);
  const pending = daemon.monitor.snapshot().permissions[0]!;

  await relay.command(principal, {
    commandId: randomUUID(),
    target: session.target,
    sessionId: session.id,
    generation: session.generation,
    action: { type: 'permission', requestId: pending.requestId, decision: 'allow' },
  });

  await until(
    async () =>
      daemon!.monitor.snapshot().sessions[0]?.status === 'idle' && (await assistantSeen('PERMISSION_READY')),
    60000,
  );

  report.permission = true;
  report.code = 'OK';
} catch (error) {
  report.code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'PROBE_FAILED';
  report.trustDialogSeen = trusted;
  report.sessionObserved = !!daemon?.monitor.snapshot().sessions.length;
  report.permissionPending = !!daemon?.monitor.snapshot().permissions.length;
} finally {
  if (child) {
    child.write('\x1b');
    child.write('\x03');
    await new Promise((resolve) => setTimeout(resolve, 300));
    child.write('/exit\r');
    await new Promise((resolve) => setTimeout(resolve, 1200));

    try {
      child.kill('SIGKILL');
    } catch {}
  }

  await mkdir('.superpowers', { recursive: true });
  await writeFile('.superpowers/managed-cli-output.txt', text, { mode: 0o600 });
  await daemon?.close();
  await relay?.close();
  const pool = new Pool({ connectionString: url });

  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.end();
  await rm(directory, { recursive: true, force: true });
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/managed-cli-compatibility.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
