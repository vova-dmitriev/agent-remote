import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { openCodexProfileProcess } from '@daemon/profiles/native/process.js';
import { profileRegistryFixture } from './fixtures/registry.fixture.js';

it('waits for its own authentication child to exit before credential cleanup can be acknowledged', async () => {
  const { directory } = profileRegistryFixture();
  const settings = join(directory, 'settings.json');

  writeFileSync(settings, '{}');

  const native = await openCodexProfileProcess({ HOME: directory, CODEX_HOME: directory }, 'subscription', {
    executable: process.execPath,
    prefixArguments: [resolve('tests/daemon/profiles/fixtures/stubborn-peer.mjs'), settings],
  });

  const pid = Number(readFileSync(join(directory, 'native-peer.pid'), 'utf8'));

  try {
    await native.close();
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* The owned synthetic child has already exited. */
    }
  }
});
