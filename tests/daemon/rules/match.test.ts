import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadyRule, RuleScopeKind } from '@protocol';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { matchCommand, rulesInForce } from '@daemon/rules/match.js';
import { projectRoot } from '@daemon/rules/project.js';
import { RulesStore, emptyRules, type RulesFile } from '@daemon/rules/store.js';

const ROOT = '/work/app';

const file = (ready: ReadyRule[], session: ReadyRule[] = [], allowed: string[] = []): RulesFile => ({
  ...emptyRules(),
  projects: { [ROOT]: { ready, own: [], allowed } },
  sessions: { 'session-1': { ready: session, own: [], allowed: [] } },
});

const stops = (rules: RulesFile, command: string, bypass = false) =>
  matchCommand(command, rulesInForce(rules, { sessionId: 'session-1', root: ROOT, bypass }), rules, ROOT)
    ?.rule.ready ?? null;

it('stops suspicious database queries and lets ordinary ones through', () => {
  const rules = file([ReadyRule.Database]);

  for (const command of [
    'psql -c "DROP TABLE users"',
    'docker exec db psql -c "delete from orders"',
    'psql -c "TRUNCATE sessions"',
    "psql -c 'UPDATE t SET a=1;'",
  ]) {
    expect(stops(rules, command), command).toBe(ReadyRule.Database);
  }

  for (const command of [
    'psql -c "SELECT 1"',
    'psql -c "DELETE FROM t WHERE id=1"',
    'psql -c "update t set a=1 where id=2"',
  ]) {
    expect(stops(rules, command), command).toBeNull();
  }
});

it('stops rm -rf outside the project, force pushes, and nothing else', () => {
  const rules = file([ReadyRule.RemoveOutsideProject, ReadyRule.ForcePush]);

  expect(stops(rules, 'rm -rf /tmp/x')).toBe(ReadyRule.RemoveOutsideProject);
  expect(stops(rules, 'rm -rf ../other')).toBe(ReadyRule.RemoveOutsideProject);
  expect(stops(rules, 'rm -rf ./build')).toBeNull();
  expect(stops(rules, `rm -rf ${ROOT}/dist`)).toBeNull();
  expect(stops(rules, 'git push --force')).toBe(ReadyRule.ForcePush);
  expect(stops(rules, 'git push -f origin main')).toBe(ReadyRule.ForcePush);
  expect(stops(rules, 'git push origin main')).toBeNull();
});

it('keeps only session rules in a bypass session, and lets an allowed exact command through', () => {
  const rules = file([ReadyRule.Database], [ReadyRule.ForcePush], ['psql -c "DROP TABLE scratch"']);

  expect(stops(rules, 'psql -c "DROP TABLE users"', true)).toBeNull();
  expect(stops(rules, 'git push --force', true)).toBe(ReadyRule.ForcePush);
  expect(stops(rules, 'psql -c "DROP TABLE scratch"')).toBeNull();
  expect(stops(rules, 'psql -c "DROP TABLE users"')).toBe(ReadyRule.Database);
});

it('matches an own rule by its patterns, case-insensitively', () => {
  const rules = file([]);

  rules.sessions['session-1']!.own.push({
    id: 'own-1',
    name: 'Prod',
    ready: null,
    sentence: 'prod',
    patterns: ['prod-db'],
  });

  const match = matchCommand(
    'psql -h PROD-DB -c "select 1"',
    rulesInForce(rules, { sessionId: 'session-1', root: ROOT, bypass: true }),
    rules,
    ROOT,
  );

  expect(match).toMatchObject({
    rule: { id: 'own-1' },
    scope: { kind: RuleScopeKind.Session, key: 'session-1' },
  });
});

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rules-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it('keeps both changes made through two stores of the same file', () => {
  const path = join(directory, 'rules.json');
  const first = new RulesStore(path);
  const second = new RulesStore(path);

  first.update((rules) => {
    rules.projects[ROOT] = { ready: [ReadyRule.Database], own: [], allowed: [] };
  });

  second.update((rules) => {
    rules.sessions['session-1'] = { ready: [ReadyRule.ForcePush], own: [], allowed: [] };
  });

  expect(first.read()).toMatchObject({
    projects: { [ROOT]: { ready: [ReadyRule.Database] } },
    sessions: { 'session-1': { ready: [ReadyRule.ForcePush] } },
  });
});

it('finds the git repository of a working directory', async () => {
  await mkdir(join(directory, 'repo', '.git'), { recursive: true });
  await mkdir(join(directory, 'repo', 'src', 'deep'), { recursive: true });

  expect(await projectRoot(join(directory, 'repo', 'src', 'deep'))).toBe(join(directory, 'repo'));
  expect(await projectRoot(directory)).toBe(directory);
});
