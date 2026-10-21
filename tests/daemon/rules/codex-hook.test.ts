/*
 * Codex 0.149 hooks, from its binary (no live probe yet: it needs the owner's Codex login in a scratch home):
 * hooks.json in Claude's format; PreToolUse input carries session_id (the thread), tool_name, tool_input,
 * permission_mode (Claude's names, incl. bypassPermissions); its shell tool is `exec_command` with `cmd`;
 * PreToolUse accepts permissionDecision "deny" with a non-empty reason and rejects "allow" and "ask".
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PermissionDecision, ReadyRule, type Session } from '@protocol';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { PermissionBroker } from '@daemon/commands/permission-broker.js';
import { installHooks, uninstallHooks } from '@daemon/code/hooks/install-hooks.js';
import { HookAgent } from '@daemon/domain/ipc.js';
import { RuleGuard, ruleHookOutput } from '@daemon/rules/check.js';
import { RulesStore } from '@daemon/rules/store.js';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'codex-hook-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("installs one PreToolUse hook into Codex's hooks.json beside the owner's, and removes only it", async () => {
  const path = join(directory, 'hooks.json');
  const own = { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'owner-check' }] }] } };

  await writeFile(path, JSON.stringify(own));
  await installHooks(path, '/absolute/remote.mjs', HookAgent.Codex);

  const installed = JSON.parse(await readFile(path, 'utf8'));

  expect(Object.keys(installed.hooks)).toEqual(['PreToolUse']);
  expect(installed.hooks.PreToolUse).toHaveLength(2);
  expect(installed.hooks.PreToolUse[1].hooks[0]).toMatchObject({ timeout: 660 });
  expect(installed.hooks.PreToolUse[1].hooks[0].command).toContain('hook --agent=codex');

  await uninstallHooks(path);
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(own);
});

it('stops a Codex exec_command by its cmd, and answers Codex without the allow it rejects', async () => {
  const store = new RulesStore(join(directory, 'rules.json'));

  const rules = new RuleGuard({
    store,
    permissions: new PermissionBroker(),
    monitor: { publish: () => undefined },
    root: async () => '/work',
  });

  const session = { id: 'codex-thread', generation: 'g', cwd: '/work', status: 'running' } as Session;

  store.update((file) => {
    file.projects['/work'] = { ready: [ReadyRule.ForcePush], own: [], allowed: [] };
  });

  const hook = { tool_name: 'exec_command', tool_input: { cmd: 'git push -f' }, permission_mode: 'default' };

  expect(await rules.check(hook, session)).toMatchObject({ command: 'git push -f' });
  expect(await rules.check({ ...hook, permission_mode: 'bypassPermissions' }, session)).toBeNull();

  const rule = { name: 'git push --force' };

  expect(ruleHookOutput(PermissionDecision.Allow, rule, HookAgent.Codex)).toEqual({});

  expect(ruleHookOutput(PermissionDecision.Deny, rule, HookAgent.Codex)).toEqual(
    ruleHookOutput(PermissionDecision.Deny, rule),
  );
});
