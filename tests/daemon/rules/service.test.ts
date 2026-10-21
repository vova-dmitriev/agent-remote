import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadyRule, RuleAction, RuleScopeKind, type AppSnapshot, type Session } from '@protocol';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { RulesService } from '@daemon/rules/service.js';
import { RulesStore } from '@daemon/rules/store.js';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rules-service-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const sessions = [
  { id: 'session-1', cwd: '/work/app/src', permissionMode: 'bypassPermissions' },
  { id: 'session-2', cwd: '/work/docs' },
] as Session[];

function service() {
  return new RulesService({
    store: new RulesStore(join(directory, 'rules.json')),
    monitor: { snapshot: () => ({ sessions }) as AppSnapshot },
    root: async (cwd) => (cwd.startsWith('/work/app') ? '/work/app' : cwd),
    compile: async (sentence) => ({ name: sentence.slice(0, 10), patterns: ['prod'] }),
  });
}

it("lists every project of the device's sessions and the session's own and inherited rules", async () => {
  const rules = service();
  const project = { kind: RuleScopeKind.Project, key: '/work/app' };

  await rules.apply({ action: RuleAction.Toggle, scope: project, ready: ReadyRule.Database, on: true });

  await rules.apply({
    action: RuleAction.SaveOwn,
    scope: { kind: RuleScopeKind.Session, key: 'session-1' },
    name: 'Prod',
    sentence: 'ask before prod',
    patterns: ['prod'],
  });

  const view = await rules.apply({ action: RuleAction.View, sessionId: 'session-1' });

  expect(view).toMatchObject({
    projects: [
      { root: '/work/app', label: 'app', rules: [{ ready: ReadyRule.Database }] },
      { root: '/work/docs', label: 'docs', rules: [] },
    ],
    session: {
      id: 'session-1',
      root: '/work/app',
      bypass: true,
      rules: [{ name: 'Prod', sentence: 'ask before prod' }],
      fromProject: [{ ready: ReadyRule.Database }],
    },
  });
});

it('turns a ready rule off, deletes an own rule, and drafts a rule from words', async () => {
  const rules = service();
  const scope = { kind: RuleScopeKind.Project, key: '/work/app' };

  await rules.apply({ action: RuleAction.Toggle, scope, ready: ReadyRule.ForcePush, on: true });
  await rules.apply({ action: RuleAction.SaveOwn, scope, name: 'Prod', sentence: 's', patterns: ['prod'] });

  const saved = await rules.apply({ action: RuleAction.View, sessionId: null });
  const own = 'projects' in saved ? saved.projects[0]!.rules.find((rule) => rule.ready === null)! : undefined;

  await rules.apply({ action: RuleAction.Toggle, scope, ready: ReadyRule.ForcePush, on: false });
  await rules.apply({ action: RuleAction.Delete, scope, id: own!.id });

  expect(await rules.apply({ action: RuleAction.View, sessionId: null })).toMatchObject({
    projects: [{ root: '/work/app', rules: [] }, { root: '/work/docs' }],
    session: null,
  });

  expect(await rules.apply({ action: RuleAction.Compile, sentence: 'ask before prod' })).toEqual({
    name: 'ask before',
    patterns: ['prod'],
  });
});
