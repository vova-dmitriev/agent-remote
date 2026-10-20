import { expect, it } from 'vitest';
import { mkdtemp, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureManagedCodexSocket } from '@daemon/codex/launcher.js';

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
