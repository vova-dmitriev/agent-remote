import { afterEach, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { chmod, lstat, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErrorCode } from '@protocol';
import { startLocalServer } from '../../../apps/daemon/src/local/server/server.js';
import { probeCompanion } from '../../../apps/daemon/src/local/bootstrap/probe.js';
import { localFixture } from '../../helpers/local-runtime.js';

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) {
    await close();
  }
});

async function setup() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'uds-')));
  const runtime = localFixture();
  const path = join(directory, 'client.sock');

  cleanups.push(() => rm(directory, { recursive: true, force: true }), runtime.close);

  const options = {
    path,
    capability: 'synthetic-capability',
    controller: runtime.controller,
    grants: runtime.grants,
  };

  const start = async () => {
    const server = await startLocalServer(options);

    cleanups.push(server.close);

    return server;
  };

  return { directory, path, options, start };
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const exited = once(child, 'exit');

  child.kill('SIGKILL');
  await exited;
}

async function leaveStaleSocket(path: string) {
  const script = `import {createServer} from 'node:net';import {chmodSync} from 'node:fs';const path=process.argv[1];createServer(socket=>socket.destroy()).listen(path,()=>{chmodSync(path,0o600);process.send('ready')});`;

  const child = spawn(process.execPath, ['--input-type=module', '-e', script, path], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });

  cleanups.push(() => stop(child));
  await once(child, 'message');
  await stop(child);
  expect((await lstat(path)).isSocket()).toBe(true);
}

it('reclaims an owned private socket left by SIGKILL and binds a healthy new companion endpoint', async () => {
  const fixture = await setup();

  await leaveStaleSocket(fixture.path);

  await fixture.start();

  expect(await probeCompanion(fixture.path, fixture.options.capability)).toMatchObject({
    protocolVersion: 1,
  });

  expect((await lstat(fixture.path)).mode & 0o777).toBe(0o600);
});

it('never unlinks or replaces an existing live endpoint', async () => {
  const fixture = await setup();

  await fixture.start();
  const previous = await lstat(fixture.path);

  await expect(fixture.start()).rejects.toThrow(ErrorCode.LOCAL_COMPANION_MISMATCH);
  expect((await lstat(fixture.path)).ino).toBe(previous.ino);

  expect(await probeCompanion(fixture.path, fixture.options.capability)).toMatchObject({
    protocolVersion: 1,
  });
});

it('refuses a stale socket with shared permissions without deleting it', async () => {
  const fixture = await setup();

  await leaveStaleSocket(fixture.path);
  await chmod(fixture.path, 0o666);
  const previous = await lstat(fixture.path);

  await expect(fixture.start()).rejects.toThrow(ErrorCode.UNAUTHORIZED);
  expect((await lstat(fixture.path)).ino).toBe(previous.ino);
});

it('refuses a shared parent directory without removing its stale socket', async () => {
  const fixture = await setup();

  await leaveStaleSocket(fixture.path);
  await chmod(fixture.directory, 0o777);
  const previous = await lstat(fixture.path);

  await expect(fixture.start()).rejects.toThrow(ErrorCode.UNAUTHORIZED);
  expect((await lstat(fixture.path)).ino).toBe(previous.ino);
  await chmod(fixture.directory, 0o700);
});

it('refuses a symlink or ordinary file at the endpoint path', async () => {
  const fixture = await setup();
  const target = join(fixture.directory, 'untouched');

  await writeFile(target, 'synthetic', { mode: 0o600 });
  await symlink(target, fixture.path);
  await expect(fixture.start()).rejects.toThrow(ErrorCode.UNAUTHORIZED);
  expect((await lstat(fixture.path)).isSymbolicLink()).toBe(true);
  await rm(fixture.path);
  await writeFile(fixture.path, 'synthetic', { mode: 0o600 });
  await expect(fixture.start()).rejects.toThrow(ErrorCode.UNAUTHORIZED);
  expect((await lstat(fixture.path)).isFile()).toBe(true);
});
