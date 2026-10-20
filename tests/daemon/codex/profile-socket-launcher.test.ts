import { expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureManagedCodexSocket } from '../../../apps/daemon/src/codex/launcher.js';
import { ManagedCodexLaunchEvidenceType } from '../../../apps/daemon/src/codex/launch/types.js';

it('starts a profile socket server with only its explicit environment and fixed native configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'profile-socket-'));
  const executable = join(root, 'synthetic-codex');
  const metadata = join(root, 'child.json');

  vi.stubEnv('OPENAI_API_KEY', 'synthetic-parent-credential');

  await writeFile(
    executable,
    `#!${process.execPath}\nconst net=require('node:net'),fs=require('node:fs');fs.writeFileSync(${JSON.stringify(metadata)},JSON.stringify({pid:process.pid,home:process.env.HOME,key:process.env.OPENAI_API_KEY??null,args:process.argv.slice(2)}));const server=net.createServer(s=>s.on('error',()=>{}));server.listen(process.argv.at(-1).slice(7));process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`,
  );

  await chmod(executable, 0o700);

  try {
    const options = {
      environment: { HOME: '/synthetic/profile-home' },
      prefixArguments: ['-c', 'cli_auth_credentials_store="file"'],
    };

    const socketPath = await ensureManagedCodexSocket(root, executable, options);

    const child = JSON.parse(await readFile(metadata, 'utf8'));
    const evidence: { type: string; pid?: number }[] = [];

    expect(
      await ensureManagedCodexSocket(root, executable, {
        ...options,
        onEvidence: (value) => evidence.push(value),
      }),
    ).toBe(socketPath);

    expect(child.home).toBe('/synthetic/profile-home');
    expect(child.key).toBeNull();
    expect(child.args.slice(0, 3)).toEqual(['-c', 'cli_auth_credentials_store="file"', 'app-server']);
    expect(evidence).toContainEqual({ type: ManagedCodexLaunchEvidenceType.ChildCreated, pid: child.pid });
  } finally {
    vi.unstubAllEnvs();

    try {
      process.kill(JSON.parse(await readFile(metadata, 'utf8')).pid, 'SIGTERM');
    } catch {}

    await rm(root, { recursive: true, force: true });
  }
});
