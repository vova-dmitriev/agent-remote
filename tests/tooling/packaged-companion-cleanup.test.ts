import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { packagedCompanionFixture } from '../helpers/packaged-companion.js';

it('removes its owned temporary package tree when the fixture compiler fails', async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'packaged-companion-failure-'));
  const failingNode = join(temporaryDirectory, 'failing-node');

  try {
    await writeFile(failingNode, '#!/bin/sh\nexit 17\n', { mode: 0o700 });

    await expect(packagedCompanionFixture(failingNode, { temporaryDirectory })).rejects.toThrow();

    await expect(readdir(temporaryDirectory)).resolves.toEqual(['failing-node']);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}, 30_000);
