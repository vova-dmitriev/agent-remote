import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErrorCode, MAX_SESSION_FILE_BYTES, type Session } from '@protocol';
import { readSessionFile } from '@daemon/files/session-files.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'session-files-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const session = (paths: string[], cwd = root) =>
  ({
    id: 's',
    cwd,
    changes: {
      files: paths.map((path, index) => ({
        id: String(index),
        path,
        kind: 'update',
        patch: '',
        truncated: false,
      })),
      truncated: false,
    },
  }) as unknown as Session;

const monitor = (value: Session | undefined) => ({ session: () => value });

it('reads a file the session changed, by absolute or cwd-relative path', async () => {
  await writeFile(join(root, 'NOTES.md'), '# Notes\nbody');

  expect(
    await readSessionFile(monitor(session([join(root, 'NOTES.md')])), 's', join(root, 'NOTES.md')),
  ).toEqual({
    path: join(root, 'NOTES.md'),
    content: '# Notes\nbody',
    truncated: false,
  });

  expect((await readSessionFile(monitor(session(['NOTES.md'])), 's', 'NOTES.md')).content).toBe(
    '# Notes\nbody',
  );
});

it('never reads a file the session did not change, a symlink, a binary file or an unknown session', async () => {
  await writeFile(join(root, 'secret.txt'), 'secret');
  await writeFile(join(root, 'image.bin'), Buffer.from([0x89, 0x50, 0x00, 0x01]));
  await symlink(join(root, 'secret.txt'), join(root, 'link.md'));

  const changed = session([join(root, 'link.md'), join(root, 'image.bin')]);

  await expect(readSessionFile(monitor(changed), 's', join(root, 'secret.txt'))).rejects.toThrow(
    ErrorCode.ACCESS_DENIED,
  );

  await expect(readSessionFile(monitor(changed), 's', join(root, 'link.md'))).rejects.toThrow(
    ErrorCode.NOT_FOUND,
  );

  await expect(readSessionFile(monitor(changed), 's', join(root, 'image.bin'))).rejects.toThrow(
    ErrorCode.CAPABILITY_UNAVAILABLE,
  );

  await expect(readSessionFile(monitor(undefined), 's', join(root, 'secret.txt'))).rejects.toThrow(
    ErrorCode.NOT_FOUND,
  );
});

it('shows the start of a large file and says it is cut', async () => {
  await writeFile(join(root, 'big.md'), 'x'.repeat(MAX_SESSION_FILE_BYTES + 10));

  const file = await readSessionFile(monitor(session([join(root, 'big.md')])), 's', join(root, 'big.md'));

  expect(file.content).toHaveLength(MAX_SESSION_FILE_BYTES);
  expect(file.truncated).toBe(true);
});
