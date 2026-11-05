import { expect, it } from 'vitest';
import { lstat, mkdir, mkdtemp, writeFile, chmod, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ensureManagedCodexSocket,
  managedCodexSocketExited,
  stopManagedCodexSocket,
} from '@daemon/codex/launcher.js';

it('starts only one private local server and reuses its socket', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-launcher-')),
    executable = join(root, 'codex-fixture');

  const pidFile = join(root, 'child.pid');

  await writeFile(
    executable,
    `#!${process.execPath}\nconst net=require('node:net'),fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));const p=process.argv.at(-1).slice(7);const server=net.createServer(s=>s.on('error',()=>{}));server.listen(p);process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`,
  );

  await chmod(executable, 0o700);

  try {
    const path = await ensureManagedCodexSocket(root, executable);
    const first = await readFile(pidFile, 'utf8');

    expect(await ensureManagedCodexSocket(root, executable)).toBe(path);
    expect(await readFile(pidFile, 'utf8')).toBe(first);
  } finally {
    try {
      process.kill(Number(await readFile(pidFile, 'utf8')), 'SIGTERM');
    } catch {}

    await rm(root, { recursive: true, force: true });
  }
});

it('replaces a link left by an earlier boot, whose socket under /tmp is gone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-launcher-')),
    executable = join(root, 'codex-fixture'),
    pidFile = join(root, 'child.pid'),
    link = join(root, 'codex/app-server.sock');

  await writeFile(
    executable,
    `#!${process.execPath}\nconst net=require('node:net'),fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));const p=process.argv.at(-1).slice(7);const server=net.createServer(s=>s.on('error',()=>{}));server.listen(p);process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`,
  );

  await chmod(executable, 0o700);
  await mkdir(join(root, 'codex'), { mode: 0o700 });
  await symlink(join(root, 'gone-after-reboot'), link);

  try {
    expect(await ensureManagedCodexSocket(root, executable)).toBe(link);
    expect((await lstat(link)).isSocket()).toBe(true);
  } finally {
    process.kill(Number(await readFile(pidFile, 'utf8')), 'SIGTERM');
    await rm(root, { recursive: true, force: true });
  }
});

it('stops the app-server it started, by the pid it recorded, and leaves a stale pid alone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-launcher-')),
    executable = join(root, 'codex-fixture'),
    pidFile = join(root, 'child.pid');

  await writeFile(
    executable,
    `#!${process.execPath}\nconst net=require('node:net'),fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));const p=process.argv.at(-1).slice(7);const server=net.createServer(s=>s.on('error',()=>{}));server.listen(p);process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`,
  );

  await chmod(executable, 0o700);

  try {
    const path = await ensureManagedCodexSocket(root, executable);

    expect(await stopManagedCodexSocket(root)).toBe(true);
    expect(await managedCodexSocketExited(path)).toBe(true);

    // The socket no longer answers: a recorded pid is not signalled.
    await writeFile(join(root, 'codex/app-server.pid'), String(process.pid));
    expect(await stopManagedCodexSocket(root)).toBe(false);
  } finally {
    try {
      process.kill(Number(await readFile(pidFile, 'utf8')), 'SIGTERM');
    } catch {}

    await rm(root, { recursive: true, force: true });
  }
});
