import { expect, it } from 'vitest';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NativeProcesses } from '../../../apps/daemon/src/sessions/native-process.js';

const execute = promisify(execFile);

it('requires an owned native record, matching OS process start time and executable before stopping a process', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'native-restart-')),
    previous = process.env.PATH;

  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });

  try {
    await mkdir(join(directory, 'sessions'));
    await symlink(process.execPath, join(directory, 'claude'));
    process.env.PATH = directory + ':' + previous;

    const procStart = (
      await execute('/bin/ps', ['-p', String(child.pid), '-o', 'lstart='], {
        env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
      })
    ).stdout.trim();

    const record = {
      pid: child.pid!,
      sessionId: 'synthetic-native',
      cwd: directory,
      procStart,
      pidDomain: 'darwin',
      kind: 'interactive',
    };

    const path = join(directory, 'sessions', child.pid + '.json');

    await writeFile(path, JSON.stringify({ ...record, procStart: 'stale' }), { mode: 0o600 });
    const shim = join(directory, 'shim');

    await mkdir(shim);
    await writeFile(join(shim, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    process.env.PATH = shim + ':' + directory + ':' + previous;
    const native = new NativeProcesses(directory);

    expect(await native.resolve(record.sessionId, record.cwd)).toBeUndefined();
    await expect(native.stop(record)).rejects.toThrow('STALE_SESSION');
    expect(() => process.kill(child.pid!, 0)).not.toThrow();
    await writeFile(path, JSON.stringify(record));
    expect(await native.resolve(record.sessionId, record.cwd)).toMatchObject(record);
    await native.stop(record);
    expect(await native.resolve(record.sessionId, record.cwd)).toBeUndefined();
  } finally {
    child.kill();

    if (previous === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previous;
    }

    await rm(directory, { recursive: true, force: true });
  }
});

it('reports duplicate live writers without granting stop authority and recovers after one exits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'native-duplicate-'));
  const previous = process.env.CLAUDE_REMOTE_NATIVE_CLAUDE;

  const children = [
    spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }),
    spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }),
  ];

  try {
    await mkdir(join(directory, 'sessions'));
    process.env.CLAUDE_REMOTE_NATIVE_CLAUDE = process.execPath;
    const native = new NativeProcesses(directory);
    const records = [];

    expect(await native.inspect('duplicate-conversation', directory)).toEqual({ state: 'missing' });

    for (const child of children) {
      const record = {
        pid: child.pid!,
        sessionId: 'duplicate-conversation',
        cwd: directory,
        procStart: (
          await execute('/bin/ps', ['-p', String(child.pid), '-o', 'lstart='], {
            env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
          })
        ).stdout.trim(),
        pidDomain: 'darwin',
        kind: 'interactive',
      };

      records.push(record);

      await writeFile(join(directory, 'sessions', child.pid + '.json'), JSON.stringify(record), {
        mode: 0o600,
      });
    }

    expect(await native.inspect('duplicate-conversation', directory)).toEqual({ state: 'ambiguous' });
    expect(await native.resolve('duplicate-conversation', directory)).toBeUndefined();
    await expect(native.stop(records[0]!)).rejects.toThrow('STALE_SESSION');
    expect(() => process.kill(children[0]!.pid!, 0)).not.toThrow();
    expect(() => process.kill(children[1]!.pid!, 0)).not.toThrow();

    await new Promise<void>((resolve) => {
      children[1]!.once('exit', () => resolve());
      children[1]!.kill();
    });

    expect(await native.inspect('duplicate-conversation', directory)).toMatchObject({
      state: 'available',
      process: records[0],
    });

    expect(await native.resolve('duplicate-conversation', directory)).toMatchObject(records[0]!);
    expect(await native.inspect('different-conversation', directory)).toEqual({ state: 'missing' });
  } finally {
    children.forEach((child) => child.kill());

    if (previous === undefined) {
      delete process.env.CLAUDE_REMOTE_NATIVE_CLAUDE;
    } else {
      process.env.CLAUDE_REMOTE_NATIVE_CLAUDE = previous;
    }

    await rm(directory, { recursive: true, force: true });
  }
});
