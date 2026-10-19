import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { ErrorCode, LocalOperation } from '@protocol';
import { createDesktopCompanionConnector } from '../apps/desktop/src/runtime/connector.js';
import { desktopRuntimeFixture } from './helpers/desktop-runtime-fixture.js';

const runFile = promisify(execFile);
const cleanups: Array<() => Promise<unknown>> = [];
const itOnDarwin = it.skipIf(process.platform !== 'darwin');

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

itOnDarwin(
  'connects through the packaged companion with SQLite and helper health, approval, reopen, and revocation',
  async () => {
    const packaged = await desktopRuntimeFixture();
    const userData = join(packaged.root, 'private user data');
    const directory = join(userData, 'desktop-companion');

    await mkdir(directory, { recursive: true, mode: 0o700 });

    const environment = {
      ...process.env,
      PATH: '',
      HOME: join(packaged.root, 'home'),
      CLAUDE_REMOTE_HOME: directory,
      CLAUDE_CONFIG_DIR: join(packaged.root, 'claude-config'),
      CODEX_HOME: join(packaged.root, 'codex-home'),
      TMPDIR: join(packaged.root, 'tmp'),
      REMOTE_INPUT_ENABLED: '0',
      REMOTE_PERMISSIONS_ENABLED: '0',
    };

    for (const path of [
      environment.HOME,
      environment.CLAUDE_CONFIG_DIR,
      environment.CODEX_HOME,
      environment.TMPDIR,
    ]) {
      await mkdir(path, { recursive: true, mode: 0o700 });
    }

    const childScript = `
import { startDaemon } from './dist/apps/daemon/src/main.js';
import { BridgeClient } from './dist/apps/daemon/src/desktop/bridge-client.js';
import { spawn } from 'node-pty';
const daemon = await startDaemon();
const bridge = new BridgeClient();
const helper = await bridge.request({ operation: 'synthetic-empty' });
if (!Array.isArray(helper) || helper.length !== 0) throw new Error('FIXTURE_HELPER_INVALID');
const pty = spawn('/bin/sh', ['-c', 'printf DESKTOP_PTY_OK'], { cwd: process.cwd(), env: process.env, cols: 80, rows: 24 });
const ptyOutput = await new Promise((resolve, reject) => {
  let output = '';
  const timer = setTimeout(() => { pty.kill(); reject(new Error('PTY_SMOKE_TIMEOUT')); }, 5000);
  pty.onData((data) => { output += data; });
  pty.onExit(() => { clearTimeout(timer); resolve(output); });
});
if (!ptyOutput.includes('DESKTOP_PTY_OK')) throw new Error('PTY_SMOKE_FAILED');
process.stdout.write('PACKAGED_DAEMON_READY\\n');
process.once('SIGTERM', async () => {
  bridge.close();
  await daemon.close();
  process.exit(0);
});
`;

    const child = spawn(packaged.nodePath, ['--input-type=module', '-e', childScript], {
      cwd: packaged.artifact,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let errors = '';

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (errors += chunk));

    cleanups.push(async () => {
      child.kill('SIGTERM');

      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) {
          resolve();
        } else {
          child.once('exit', () => resolve());
        }
      });

      await packaged.close();
      await rm(userData, { recursive: true, force: true });
    });

    await expect.poll(() => output.includes('PACKAGED_DAEMON_READY'), { timeout: 30_000 }).toBe(true);
    expect(errors).toBe('');

    const identity = JSON.parse(await readFile(join(directory, 'local-identity.json'), 'utf8')) as {
      deviceId: string;
      instanceId: string;
    };

    let confirmations = 0;

    const options = {
      verifiedResourceRoot: packaged.resourceRoot,
      privateUserDataRoot: userData,
      platform: process.platform,
      architecture: process.arch,
      appVersion: '0.1.0',
      confirmLocalAccess: async () => {
        confirmations++;

        return true;
      },
    };

    const connector = await createDesktopCompanionConnector(options);

    cleanups.push(() => connector.close());

    await expect(connector.request({ operation: LocalOperation.Devices })).resolves.toContainEqual(
      expect.objectContaining({ id: identity.deviceId }),
    );

    expect(confirmations).toBe(1);
    await connector.close();

    const reopened = await createDesktopCompanionConnector(options);

    cleanups.push(() => reopened.close());

    await expect(reopened.request({ operation: LocalOperation.Devices })).resolves.toContainEqual(
      expect.objectContaining({ id: identity.deviceId }),
    );

    expect(confirmations).toBe(1);
    await reopened.close();

    await runFile(
      packaged.nodePath,
      [join(packaged.artifact, 'apps/daemon/bin/remote.mjs'), 'browser', 'revoke', identity.instanceId],
      { cwd: directory, env: environment, timeout: 10_000 },
    );

    await expect(createDesktopCompanionConnector(options)).rejects.toThrow(ErrorCode.LOCAL_GRANT_REVOKED);
    expect(confirmations).toBe(1);
  },
  60_000,
);
