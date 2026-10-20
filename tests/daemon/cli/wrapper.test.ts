import { describe, it, expect } from 'vitest';
import { createServer } from 'node:net';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startClaude } from '../../../apps/daemon/src/cli/wrapper.js';

describe('local wrapper startup', () => {
  it('registers the local control channel before starting a child that emits SessionStart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wrapper-start-')),
      flag = join(dir, 'registered');

    const oldPath = process.env.PATH,
      oldHome = process.env.CLAUDE_REMOTE_HOME;

    process.env.CLAUDE_REMOTE_HOME = dir;
    process.env.PATH = dir + ':' + oldPath;

    await writeFile(
      join(dir, 'claude'),
      `#!${process.execPath}\nconst fs=require('node:fs');console.log(fs.existsSync(${JSON.stringify(flag)})?'REGISTERED_BEFORE_START':'STARTED_TOO_EARLY');`,
    );

    await chmod(join(dir, 'claude'), 0o700);

    const server = createServer((socket) => {
      socket.on('error', () => {});
      let timer: ReturnType<typeof setTimeout>;

      socket.once('data', () => {
        timer = setTimeout(() => {
          void writeFile(flag, 'ok').then(() => socket.write(JSON.stringify({ type: 'registered' }) + '\n'));
        }, 1500);
      });

      socket.on('close', () => clearTimeout(timer));
    });

    await new Promise<void>((resolve) => server.listen(join(dir, 'hooks.sock'), resolve));
    let output = '';
    const stdin = new PassThrough();

    const stdout = new Writable({
      write(chunk, _encoding, next) {
        output += String(chunk);
        next();
      },
    });

    try {
      expect(
        await startClaude([], {
          stdin: stdin as unknown as NodeJS.ReadStream,
          stdout: stdout as unknown as NodeJS.WriteStream,
        }),
      ).toBe(0);

      expect(output).toContain('REGISTERED_BEFORE_START');
      expect(output).not.toContain('STARTED_TOO_EARLY');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));

      if (oldPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = oldPath;
      }

      if (oldHome === undefined) {
        delete process.env.CLAUDE_REMOTE_HOME;
      } else {
        process.env.CLAUDE_REMOTE_HOME = oldHome;
      }

      await rm(dir, { recursive: true, force: true });
    }
  });
});
