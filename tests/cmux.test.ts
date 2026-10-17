import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CmuxClient } from '../apps/daemon/src/cmux/client.js';
import type { CmuxTarget } from '../packages/protocol/src/index.js';

const target: CmuxTarget = {
  kind: 'cmux',
  deviceId: 'device-a',
  connectorId: 'connector-a',
  windowId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  surfaceId: '33333333-3333-4333-8333-333333333333',
};

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cmux-client-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function executable(source: string) {
  const path = join(root, 'fake-cmux');

  await writeFile(path, `#!${process.execPath}\n${source}`);
  await chmod(path, 0o700);

  return path;
}

describe('CmuxClient', () => {
  it('passes every target UUID explicitly and requests only 200 screen lines', async () => {
    const binary = await executable(
      'process.stdin.resume(); process.stdin.on("end", () => console.log(JSON.stringify(process.argv.slice(2))));',
    );

    const client = new CmuxClient({ executable: binary });

    expect(JSON.parse(await client.readScreen(target))).toEqual([
      'read-screen',
      '--window',
      target.windowId,
      '--workspace',
      target.workspaceId,
      '--surface',
      target.surfaceId,
      '--lines',
      '200',
    ]);
  });

  it('submits leading dashes and shell syntax as literal stdin, never CLI options', async () => {
    const recorded = join(root, 'recorded.json');

    const binary = await executable(
      `const fs = require('node:fs'); let input=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk=>input+=chunk); process.stdin.on('end',()=>fs.writeFileSync(${JSON.stringify(recorded)},JSON.stringify({args:process.argv.slice(2),input})));`,
    );

    const client = new CmuxClient({ executable: binary });
    const text = '--help; $(touch forbidden) `pwd`\nПривет';

    await client.pasteAndSubmit(target, text);
    const { readFile } = await import('node:fs/promises');
    const result = JSON.parse(await readFile(recorded, 'utf8'));

    expect(result.args).toEqual([
      'paste',
      '--window',
      target.windowId,
      '--workspace',
      target.workspaceId,
      '--surface',
      target.surfaceId,
      '--submit',
      '-',
    ]);

    expect(result.input).toBe(text);
    await client.sendEscape(target);
    expect(JSON.parse(await readFile(recorded, 'utf8')).args.at(-1)).toBe('Escape');
  });

  it('rejects implicit targets and terminal controls before launching a process', async () => {
    const client = new CmuxClient({ executable: join(root, 'does-not-exist') });

    await expect(client.readScreen({ ...target, surfaceId: 'current' })).rejects.toThrow(
      'INVALID_CMUX_TARGET',
    );

    await expect(client.pasteAndSubmit(target, '\x1b[201~whoami')).rejects.toThrow('INVALID_PROMPT');

    await expect(client.readScreen({ ...target, kind: 'other' } as unknown as CmuxTarget)).rejects.toThrow(
      'INVALID_CMUX_TARGET',
    );
  });

  it('caps screen text without splitting a UTF-8 character', async () => {
    const binary = await executable('process.stdout.write("👋".repeat(20_000));');
    const text = await new CmuxClient({ executable: binary }).readScreen(target);

    expect(Buffer.byteLength(text)).toBe(65_536);
    expect(text.endsWith('👋')).toBe(true);
  });

  it('enforces the deadline even when the CLI ignores SIGTERM', async () => {
    const pidFile = join(root, 'pid');

    const binary = await executable(
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`,
    );

    const client = new CmuxClient({ executable: binary, timeoutMs: 300 });
    const started = Date.now();

    const result = client.readScreen(target).then(
      () => 'success',
      (error) => (error as Error).message,
    );

    let settled = false;

    void result.then(() => {
      settled = true;
    });

    // Safety timer only cleans up this disposable fixture if the deadline is broken.
    const cleanup = setTimeout(async () => {
      try {
        process.kill(Number(await readFile(pidFile, 'utf8')), 'SIGKILL');
      } catch {
        /* Already exited. */
      }
    }, 1_000);

    try {
      expect(await result).toBe('CMUX_COMMAND_FAILED');
      expect(Date.now() - started).toBeLessThan(800);
      expect(settled).toBe(true);
    } finally {
      clearTimeout(cleanup);
    }
  });

  it('terminates a stalled CLI call', async () => {
    const binary = await executable('setInterval(()=>{},1000);');

    await expect(new CmuxClient({ executable: binary, timeoutMs: 100 }).readScreen(target)).rejects.toThrow(
      'CMUX_COMMAND_FAILED',
    );
  });
});
