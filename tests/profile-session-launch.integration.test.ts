import { afterEach, expect, it } from 'vitest';
import { AgentProvider } from '../packages/protocol/src/index.js';
import { cleanupProfileLaunchFixtures, create, setupPeer } from './profile-session-launch.fixture.js';
import { readPeerEvents, stopControlledPeer } from './helpers/profile-codex-peer.js';

afterEach(async () => {
  await cleanupProfileLaunchFixtures();
});

it('isolates two selected profiles and verifies each native account, model, and effort before creating a thread', async () => {
  const one = await setupPeer('first');
  const two = await setupPeer('second');
  let launchOne: Awaited<ReturnType<typeof one.runtime.prepareExecution>> | undefined;
  let launchTwo: Awaited<ReturnType<typeof two.runtime.prepareExecution>> | undefined;

  try {
    const resultOne = await create(one, one.model, 'high');
    const resultTwo = await create(two, two.model, 'low');

    launchOne = resultOne.launch;
    launchTwo = resultTwo.launch;
    const eventsOne = await readPeerEvents(resultOne.launch.environment.CODEX_HOME!);
    const eventsTwo = await readPeerEvents(resultTwo.launch.environment.CODEX_HOME!);

    expect(resultOne.namespace.socketPath).not.toBe(resultTwo.namespace.socketPath);
    expect(eventsOne.find((event) => event.type === 'account')?.email).toBe('profile@example.test');

    expect(eventsTwo.find((event) => event.type === 'account')?.home).toBe(
      resultTwo.launch.environment.CODEX_HOME,
    );

    expect(eventsOne.find((event) => event.type === 'thread-start')).toMatchObject({
      model: one.model,
      effort: 'high',
    });

    expect(eventsTwo.find((event) => event.type === 'thread-start')).toMatchObject({
      model: two.model,
      effort: 'low',
    });

    expect(one.monitor.session(resultOne.sessionId)?.status).toBe('idle');
    expect(two.monitor.session(resultTwo.sessionId)?.status).toBe('idle');
  } finally {
    const pidOne = launchOne?.executionLease.processId();
    const pidTwo = launchTwo?.executionLease.processId();

    await Promise.all([one.manager.close(), two.manager.close()]);

    await Promise.all([
      stopControlledPeer(pidOne, launchOne?.environment.CODEX_HOME ?? one.root),
      stopControlledPeer(pidTwo, launchTwo?.environment.CODEX_HOME ?? two.root),
    ]);

    await Promise.all([one.runtime.close(), two.runtime.close()]);
    one.permissions.close();
    two.permissions.close();
    one.store.close();
    two.store.close();
    one.database.close();
    two.database.close();
  }
});

it.each([
  ['identity_mismatch', 'PROFILE_MISMATCH', false],
  ['model_mismatch', 'UNKNOWN_AFTER_WRITE', true],
  ['effort_mismatch', 'UNKNOWN_AFTER_WRITE', true],
  ['lost_ack', 'UNKNOWN_AFTER_WRITE', true],
] as const)(
  'does not create or replay an uncertain profiled thread for %s',
  async (scenario, error, created) => {
    const fixture = await setupPeer(scenario);
    let launch: Awaited<ReturnType<typeof fixture.runtime.prepareExecution>> | undefined;

    try {
      const prepared = await fixture.runtime.prepareExecution(
        {
          profileId: fixture.profile.id,
          provider: AgentProvider.Codex,
          model: fixture.model,
          effort: 'high',
        },
        fixture.profile.version,
      );

      launch = prepared;

      await expect(fixture.manager.createSession(fixture.root, prepared)).rejects.toThrow(error);
      const events = await readPeerEvents(prepared.environment.CODEX_HOME!);
      const starts = events.filter((event) => event.type === 'thread-start');

      expect(starts).toHaveLength(created ? 1 : 0);
      expect(events.filter((event) => event.type === 'account')).toHaveLength(1);
    } finally {
      const pid = launch?.executionLease.processId();

      await fixture.manager.close();
      await stopControlledPeer(pid, launch?.environment.CODEX_HOME ?? fixture.root);
      await fixture.runtime.close();
      fixture.permissions.close();
      fixture.store.close();
      fixture.database.close();
    }
  },
);
