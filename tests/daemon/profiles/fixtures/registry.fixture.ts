import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { LocalDatabase } from '@daemon/local/state/database.js';
import { ProfileRegistry } from '@daemon/profiles/registry.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    cleanup();
  }
});

export function profileRegistryFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'execution-profiles-'));
  const path = join(directory, 'profiles.sqlite');
  const databases: LocalDatabase[] = [];

  cleanups.push(() => {
    for (const database of databases) {
      database.close();
    }

    rmSync(directory, { recursive: true, force: true });
  });

  function database() {
    const connection = new LocalDatabase(path);

    databases.push(connection);

    return connection;
  }

  function open(ownerId = 'owner-a', deviceId = 'mac-a') {
    return new ProfileRegistry(database(), { ownerId, deviceId });
  }

  return { directory, open, database };
}

export const codexSubscription = {
  provider: 'codex' as const,
  authMode: 'subscription' as const,
  label: 'OpenAI Personal',
};

export function verifiedAccount(accountRef = 'synthetic-account-a', workspaceRef = 'workspace-a') {
  return {
    provider: 'codex' as const,
    authMode: 'subscription' as const,
    identity: { accountRef, workspaceRef, verifiedAt: 1000 },
    capabilities: {
      isolation: 'supported' as const,
      createSession: true,
      contextSeed: true,
      resume: false,
      quota: false,
    },
    models: [{ id: 'synthetic-model', efforts: ['medium' as const] }],
  };
}
