import { afterEach, expect, it, vi } from 'vitest';
import {
  AnalyticsPeriod,
  ErrorCode,
  LocalOperation,
  ProfileRequestKind,
  RuleAction,
  type AnalyticsReport,
  type AppSnapshot,
} from '@protocol';
import { localFixture } from '../../helpers/local/local-runtime.js';

const fixtures: ReturnType<typeof localFixture>[] = [];

const setup = (profiles?: Parameters<typeof localFixture>[1]) => {
  const fixture = localFixture(undefined, profiles);

  fixtures.push(fixture);

  return fixture;
};

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.close();
  }
});

it('dispatches through the shared journal once and rejects stale or revoked authority', async () => {
  const f = setup();

  const command = {
    commandId: 'synthetic-command-1',
    target: f.session.target,
    sessionId: f.session.id,
    generation: f.session.generation,
    action: { type: 'prompt' as const, text: 'synthetic input' },
  };

  const send = { operation: 'send' as const, command };

  expect(await f.controller.execute(f.principal, send)).toMatchObject({ status: 'dispatched' });
  expect(await f.controller.execute(f.principal, send)).toMatchObject({ status: 'dispatched' });
  expect(f.delivered).toEqual(['synthetic input']);

  await expect(
    f.controller.execute(f.principal, {
      operation: 'rename',
      sessionId: f.session.id,
      generation: 'old',
      title: 'bad',
    }),
  ).rejects.toThrow('STALE_SESSION');

  f.grants.revoke(f.principal.clientId);

  await expect(f.controller.execute(f.principal, { operation: 'devices' })).rejects.toThrow(
    'LOCAL_GRANT_REVOKED',
  );
});

it('scopes preference/bookmark writes and rejects stale bookmark revisions', async () => {
  const f = setup();
  const position = { messageId: 'middle-message', offset: -12, updatedAt: 1000 };

  expect(
    await f.controller.execute(f.principal, { operation: 'reading_get', sessionId: f.session.id }),
  ).toEqual({ revision: 0, position: null });

  expect(
    await f.controller.execute(f.principal, {
      operation: 'reading_save',
      sessionId: f.session.id,
      revision: 0,
      position,
    }),
  ).toEqual({ revision: 1, position });

  await expect(
    f.controller.execute(f.principal, {
      operation: 'reading_save',
      sessionId: f.session.id,
      revision: 0,
      position: { ...position, messageId: 'last' },
    }),
  ).rejects.toThrow('LOCAL_REVISION_CONFLICT');

  expect(
    await f.controller.execute(f.principal, { operation: 'preferences_save', patch: { language: 'en' } }),
  ).toEqual({ language: 'en', theme: null });

  await expect(
    f.controller.execute({ ...f.principal, ownerId: 'other-owner' }, { operation: 'preferences_get' }),
  ).rejects.toThrow('LOCAL_GRANT_REVOKED');
});

it('returns only the latest bounded messages when no bookmark exists', async () => {
  const f = setup();

  for (let i = 0; i < 80; i++) {
    f.monitor.publish(f.session.id, 'message', {
      id: `message-${i}`,
      role: 'assistant',
      text: `Text ${i}`,
      occurredAt: 1000 + i,
    });
  }

  const page = await f.controller.execute(f.principal, {
    operation: 'history',
    sessionId: f.session.id,
    generation: f.session.generation,
    direction: 'latest',
  });

  expect(page).toMatchObject({ before: expect.any(String), after: null });
  expect((page as { events: unknown[] }).events).toHaveLength(30);
  expect((page as { events: { payload: { id: string } }[] }).events[0]?.payload.id).toBe('message-50');
});

it('tracks only active granted viewers for local question ownership', async () => {
  const f = setup();

  expect(f.controller.hasViewers()).toBe(false);

  const close = f.controller.subscribe(
    f.principal,
    () => {},
    () => null,
  );

  expect(f.controller.hasViewers()).toBe(true);
  close();
  expect(f.controller.hasViewers()).toBe(false);

  const revoked = f.controller.subscribe(
    f.principal,
    () => {},
    () => null,
  );

  f.grants.revoke(f.principal.clientId);
  expect(f.controller.hasViewers()).toBe(false);
  revoked();
});

it('rejects a Profiles request scoped to another device with ACCESS_DENIED', async () => {
  const request = vi.fn();

  const f = setup({
    scope: { ownerId: 'owner-local', deviceId: 'other-device' },
    request,
    close: async () => {},
  } as never);

  await expect(
    f.controller.execute(f.principal, {
      operation: LocalOperation.Profiles,
      request: { kind: ProfileRequestKind.List },
    }),
  ).rejects.toThrow(ErrorCode.ACCESS_DENIED);

  expect(request).not.toHaveBeenCalled();
});

it("pins only the device owner's current session and shows the pin in the snapshot", async () => {
  const f = setup();
  const pin = { operation: LocalOperation.Pin, sessionId: f.session.id, generation: f.session.generation };
  const pinned = () => f.monitor.snapshot().sessions.find((session) => session.id === f.session.id)?.pinned;

  await expect(
    f.controller.execute(f.principal, { ...pin, generation: 'old', pinned: true }),
  ).rejects.toThrow(ErrorCode.STALE_SESSION);

  await expect(
    f.controller.execute({ ...f.principal, ownerId: 'owner-other' }, { ...pin, pinned: true }),
  ).rejects.toThrow();

  expect(pinned()).toBeUndefined();

  expect(await f.controller.execute(f.principal, { ...pin, pinned: true })).toBeNull();
  expect(pinned()).toBe(true);
  await f.controller.execute(f.principal, { ...pin, pinned: false });
  expect(pinned()).toBeUndefined();
});

it('renames in the agent and drops the local label, keeping a label only when the agent cannot take the name', async () => {
  let native = true;
  const renamed: string[] = [];

  const f = localFixture(undefined, undefined, {
    rename: async (_sessionId, title) => {
      renamed.push(title);

      return native;
    },
  });

  fixtures.push(f);

  const rename = (title: string) =>
    f.controller.execute(f.principal, {
      operation: LocalOperation.Rename,
      sessionId: f.session.id,
      generation: f.session.generation,
      title,
    });

  const title = () =>
    (f.controller.snapshot(f.principal) as { snapshot: AppSnapshot }).snapshot.sessions.find(
      (session) => session.id === f.session.id,
    )?.title;

  native = false;
  await rename('Local label');
  expect(title()).toBe('Local label');

  native = true;
  await rename('Agent name');
  expect(renamed).toEqual(['Local label', 'Agent name']);
  // No label left to mask what the agent reports from now on.
  f.monitor.setSessionTitle(f.session.id, 'Renamed in the agent');
  expect(title()).toBe('Renamed in the agent');
});

it('reports usage only to the device owner, and says so when the store is unavailable', async () => {
  const report = { period: AnalyticsPeriod.Today } as AnalyticsReport;
  const analytics = { report: vi.fn(async () => report) };
  const f = localFixture(undefined, undefined, undefined, analytics);
  const without = setup();
  const ask = { operation: LocalOperation.Analytics, period: AnalyticsPeriod.Today } as const;

  fixtures.push(f);

  await expect(f.controller.execute({ ...f.principal, ownerId: 'owner-other' }, ask)).rejects.toThrow();
  expect(analytics.report).not.toHaveBeenCalled();
  expect(await f.controller.execute(f.principal, ask)).toBe(report);
  expect(analytics.report).toHaveBeenCalledWith(AnalyticsPeriod.Today);

  await expect(without.controller.execute(without.principal, ask)).rejects.toThrow(
    ErrorCode.CAPABILITY_UNAVAILABLE,
  );
});

it('changes rules only for the device owner', async () => {
  const rules = { apply: vi.fn(async () => ({ projects: [], session: null })) };
  const f = localFixture(undefined, undefined, undefined, undefined, rules);

  const ask = {
    operation: LocalOperation.Rules,
    request: { action: RuleAction.View, sessionId: null },
  } as const;

  fixtures.push(f);

  await expect(f.controller.execute({ ...f.principal, ownerId: 'owner-other' }, ask)).rejects.toThrow();
  expect(rules.apply).not.toHaveBeenCalled();
  expect(await f.controller.execute(f.principal, ask)).toEqual({ projects: [], session: null });
});
