import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EventType,
  PermissionDecision,
  RULE_ANSWER_TIMEOUT_MS,
  ReadyRule,
  RuleScopeKind,
  type Session,
} from '@protocol';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PermissionBroker } from '@daemon/commands/permission-broker.js';
import { RuleGuard, ruleHookOutput } from '@daemon/rules/check.js';
import { RulesStore } from '@daemon/rules/store.js';
import { localFixture } from '../../helpers/local/local-runtime.js';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rule-guard-'));
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});

const session = { id: 'session-1', generation: 'g1', cwd: '/work/app', status: 'running' } as Session;

const hook = (command: string, permission_mode = 'bypassPermissions') => ({
  hook_event_name: 'PreToolUse',
  session_id: 'claude-1',
  tool_name: 'Bash',
  tool_input: { command },
  permission_mode,
});

function guard() {
  const store = new RulesStore(join(directory, 'rules.json'));
  const permissions = new PermissionBroker();
  const published: unknown[] = [];

  const monitor = {
    publish: (_id: string | null, type: string, payload: unknown) => published.push({ type, payload }),
  };

  store.update((rules) => {
    rules.sessions['session-1'] = { ready: [ReadyRule.Database], own: [], allowed: [] };
  });

  return {
    store,
    permissions,
    published,
    guard: new RuleGuard({ store, permissions, monitor, root: async () => '/work/app' }),
  };
}

it('lets a command no rule covers through at once', async () => {
  const { guard: rules, permissions } = guard();

  expect(await rules.check(hook('psql -c "SELECT 1"'), session)).toBeNull();
  expect(permissions.pending()).toEqual([]);
});

it('stops a matching command in a bypass session, asks once and allows always on request', async () => {
  const { guard: rules, permissions, published, store } = guard();
  const stop = await rules.check(hook('psql -c "DROP TABLE users"'), session);

  expect(stop).toMatchObject({ rule: { ready: ReadyRule.Database }, scope: { kind: RuleScopeKind.Session } });

  const answer = rules.ask(stop!, hook('psql -c "DROP TABLE users"'), session);
  const [pending] = permissions.pending();

  expect(pending).toMatchObject({
    sessionId: 'session-1',
    toolName: 'Bash',
    rule: { id: 'ready-database', name: 'Suspicious database queries', scope: RuleScopeKind.Session },
  });

  expect(pending!.expiresAt - Date.now()).toBeGreaterThan(RULE_ANSWER_TIMEOUT_MS - 5000);

  expect(published).toEqual([
    {
      type: EventType.Permission,
      payload: expect.objectContaining({
        command: 'psql -c "DROP TABLE users"',
        rule: pending!.rule,
        requestId: pending!.requestId,
        generation: 'g1',
      }),
    },
  ]);

  permissions.resolve(pending!.requestId, 'g1', PermissionDecision.AllowAlways);
  expect(await answer).toBe(PermissionDecision.AllowAlways);
  expect(store.read().sessions['session-1']!.allowed).toEqual(['psql -c "DROP TABLE users"']);
  expect(await rules.check(hook('psql -c "DROP TABLE users"'), session)).toBeNull();
});

it('denies when the owner does not answer in ten minutes', async () => {
  vi.useFakeTimers();

  const { guard: rules } = guard();
  const stop = await rules.check(hook('psql -c "TRUNCATE t"'), session);
  const answer = rules.ask(stop!, hook('psql -c "TRUNCATE t"'), session);

  await vi.advanceTimersByTimeAsync(RULE_ANSWER_TIMEOUT_MS + 1);
  expect(await answer).toBe(PermissionDecision.Local);
});

it('answers the agent: allow, or deny naming the rule and why', () => {
  const rule = {
    id: 'ready-database',
    name: 'Suspicious database queries',
    ready: ReadyRule.Database,
    sentence: null,
    patterns: ['x'],
  };

  expect(ruleHookOutput(PermissionDecision.Allow, rule)).toEqual({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
  });

  expect(ruleHookOutput(PermissionDecision.Deny, rule)).toEqual({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'Agent Remote rule «Suspicious database queries»: denied by the owner',
    },
  });

  expect(ruleHookOutput(PermissionDecision.Local, rule)).toMatchObject({
    hookSpecificOutput: {
      permissionDecisionReason: 'Agent Remote rule «Suspicious database queries»: no answer in 10 minutes',
    },
  });
});

it("keeps the session's permission mode from its hooks", async () => {
  const f = localFixture();

  try {
    f.monitor.ingestHook(
      {
        hook_event_name: 'PreToolUse',
        session_id: 'synthetic-session',
        permission_mode: 'bypassPermissions',
      },
      'managed-test',
    );

    expect(f.monitor.session(f.session.id)?.permissionMode).toBe('bypassPermissions');
  } finally {
    await f.close();
  }
});
