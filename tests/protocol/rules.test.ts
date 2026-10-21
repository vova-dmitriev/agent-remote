import {
  PermissionDecision,
  RELAY_PROTOCOL,
  ReadyRule,
  RuleAction,
  RuleScopeKind,
  clientCommandSchema,
  permissionSchema,
  rulesRequestSchema,
  rulesViewSchema,
} from '@protocol';
import { expect, it } from 'vitest';

const ready = {
  id: 'ready-database',
  name: 'Suspicious database queries',
  ready: ReadyRule.Database,
  sentence: null,
  patterns: ['DROP'],
};

const own = {
  id: 'own-1',
  name: 'Prod database',
  ready: null,
  sentence: 'ask before any prod query',
  patterns: ['prod-db'],
};

it('describes the rules of a project and of a session', () => {
  const view = {
    projects: [
      { root: '/work/app', label: 'app', rules: [ready, own], allowed: ['psql -c "DELETE FROM t"'] },
    ],
    session: {
      id: 'session-1',
      root: '/work/app',
      bypass: true,
      rules: [own],
      fromProject: [ready],
      allowed: [],
    },
  };

  expect(rulesViewSchema.parse(view)).toEqual(view);

  expect(() =>
    rulesViewSchema.parse({
      ...view,
      projects: [{ ...view.projects[0], rules: [{ ...own, patterns: [] }] }],
    }),
  ).toThrow();

  expect(() =>
    rulesViewSchema.parse({
      ...view,
      projects: [{ ...view.projects[0], rules: [{ ...own, patterns: Array(21).fill('x') }] }],
    }),
  ).toThrow();
});

it('accepts each rule change and the view request', () => {
  const scope = { kind: RuleScopeKind.Project, key: '/work/app' };

  for (const request of [
    { action: RuleAction.View, sessionId: null },
    { action: RuleAction.Toggle, scope, ready: ReadyRule.ForcePush, on: true },
    { action: RuleAction.Compile, sentence: 'ask before deploys' },
    {
      action: RuleAction.SaveOwn,
      scope,
      name: 'Deploys',
      sentence: 'ask before deploys',
      patterns: ['deploy'],
    },
    { action: RuleAction.Delete, scope, id: 'own-1' },
    { action: RuleAction.ForgetCommand, scope, command: 'psql -c "DELETE FROM t"' },
  ]) {
    expect(rulesRequestSchema.parse(request)).toEqual(request);
  }
});

it('carries the matched rule on a permission and lets the owner allow always', () => {
  const permission = {
    requestId: 'r',
    sessionId: 's',
    generation: 'g',
    toolName: 'Bash',
    input: { command: 'psql -c "DROP TABLE t"' },
    expiresAt: 1,
    rule: { id: 'ready-database', name: 'Suspicious database queries', scope: RuleScopeKind.Project },
  };

  expect(permissionSchema.parse(permission)).toEqual(permission);

  expect(
    clientCommandSchema.shape.action.parse({
      type: 'permission',
      requestId: 'r',
      decision: PermissionDecision.AllowAlways,
    }),
  ).toMatchObject({ decision: 'allow_always' });

  expect(RELAY_PROTOCOL.Current).toBe(7);
});
