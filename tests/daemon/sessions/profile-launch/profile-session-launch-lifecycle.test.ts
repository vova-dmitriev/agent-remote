import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';
import { AgentProvider } from '@protocol';
import { startProfiledCodexRuntime } from '../../../../apps/daemon/src/sessions/execution/start-profiled-codex.js';
import { cleanupProfileLaunchFixtures, setupPeer } from './profile-session-launch.fixture.js';
import { stopControlledPeer, writeControlledCodexPeer } from '../../../helpers/profile-codex-peer.js';

afterEach(async () => {
  await cleanupProfileLaunchFixtures();
});

it('releases every lease sharing an owned child after its confirmed exit', async () => {
  const fixture = await setupPeer();

  const runtime = fixture.runtime as unknown as {
    ownership: { isActive(profileId: string): boolean };
  };

  const script = await writeControlledCodexPeer(fixture.root, createRequire(import.meta.url).resolve('ws'));

  const selection = {
    profileId: fixture.profile.id,
    provider: AgentProvider.Codex,
    model: fixture.model,
    effort: 'high' as const,
  };

  let first: Awaited<ReturnType<typeof fixture.runtime.prepareExecution>> | undefined;
  let second: Awaited<ReturnType<typeof fixture.runtime.prepareExecution>> | undefined;

  try {
    first = await fixture.runtime.prepareExecution(selection, fixture.profile.version);
    second = await fixture.runtime.prepareExecution(selection, fixture.profile.version);

    const options = { executable: process.execPath, prefixArguments: [script], namespaceRoot: '/tmp' };
    const firstSocket = await startProfiledCodexRuntime(first, options);
    const secondSocket = await startProfiledCodexRuntime(second, options);

    expect(secondSocket).toBe(firstSocket);
    expect(second.executionLease.processId()).toBe(first.executionLease.processId());
    expect(runtime.ownership.isActive(fixture.profile.id)).toBe(true);

    await stopControlledPeer(first.executionLease.processId(), first.environment.CODEX_HOME!);

    for (let attempt = 0; attempt < 100 && runtime.ownership.isActive(fixture.profile.id); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(runtime.ownership.isActive(fixture.profile.id)).toBe(false);
  } finally {
    await fixture.manager.close();

    await stopControlledPeer(
      first?.executionLease.processId(),
      first?.environment.CODEX_HOME ?? fixture.root,
    );

    await fixture.runtime.close();
    fixture.permissions.close();
    fixture.store.close();
    fixture.database.close();
  }
});

it('handles an owned child exit after the profile database closes', async () => {
  const fixture = await setupPeer();
  const script = await writeControlledCodexPeer(fixture.root, createRequire(import.meta.url).resolve('ws'));

  const launch = await fixture.runtime.prepareExecution(
    {
      profileId: fixture.profile.id,
      provider: AgentProvider.Codex,
      model: fixture.model,
      effort: 'high',
    },
    fixture.profile.version,
  );

  let pid: number | undefined;

  try {
    await startProfiledCodexRuntime(launch, {
      executable: process.execPath,
      prefixArguments: [script],
      namespaceRoot: '/tmp',
    });

    pid = launch.executionLease.processId();
    await fixture.runtime.close();
    fixture.database.close();

    await expect(stopControlledPeer(pid, launch.environment.CODEX_HOME!)).resolves.toBeUndefined();
  } finally {
    await stopControlledPeer(pid, launch.environment.CODEX_HOME!);
    await fixture.manager.close();
    await fixture.runtime.close();
    fixture.permissions.close();
    fixture.store.close();

    if (fixture.database.connection.open) {
      fixture.database.close();
    }
  }
});
