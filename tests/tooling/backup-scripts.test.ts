import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

it('backs up the explicitly selected database and keeps private archive permissions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'backup-test-'));

  try {
    const bin = join(dir, 'docker');

    await writeFile(bin, '#!/bin/sh\nprintf "%s\\n" "$@" > "$BACKUP_ARGUMENTS"\nprintf "fixture dump"\n');
    await chmod(bin, 0o700);
    const args = join(dir, 'args');

    const result = execFileSync('/bin/sh', [resolve('scripts/server/backup-db.sh'), join(dir, 'out')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: dir + ':' + process.env.PATH,
        BACKUP_ARGUMENTS: args,
        BACKUP_DATABASE: 'explicit_test_db',
      },
    }).trim();

    expect(await readFile(args, 'utf8')).toContain('explicit_test_db');
    expect(await readFile(result, 'utf8')).toBe('fixture dump');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
