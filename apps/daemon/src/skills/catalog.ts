import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SessionSkill, SessionSkills } from '@protocol';
import { checked, type CatalogRequest } from './filesystem.js';
import { cliPluginSkillRoots, installedPluginSkillRoots } from './plugins/catalog.js';
import { boundedSkills, scanSkillRoot } from './scanner.js';
import { argValues, hiddenSkillNames, skillRoots, sourceEnabled } from './sources.js';
import type { SkillRoot } from './sources.js';
import { SKILL_CLI_FLAGS, SKILL_ROOT_KIND, SKILL_SETTING_SOURCE, SKILLS_SCAN_LIMIT } from './values.js';

export async function discoverSessionSkills(request: CatalogRequest): Promise<SessionSkills> {
  const unsupported: SessionSkills = {
    sessionId: '',
    generation: '',
    supported: false,
    truncated: false,
    skills: [],
  };

  const resolvedCwd = await checked(request, () => realpath(request.cwd)).catch(() => undefined); // ignore: unavailable scope yields no metadata.
  const resolvedHome = await checked(request, () => realpath(request.home)).catch(() => undefined); // ignore: unavailable scope yields no metadata.

  const resolvedConfig = await checked(request, () => realpath(request.configDirectory)).catch(
    () => undefined,
  ); // ignore: unavailable scope yields no metadata.

  if (!resolvedCwd || !resolvedHome || !resolvedConfig) {
    return unsupported;
  }

  const hidden = await hiddenSkillNames(request, resolvedCwd);
  const candidates = new Map<string, { skill: SessionSkill; priority: number }>();

  const budget = {
    directories: SKILLS_SCAN_LIMIT.directories,
    bytes: SKILLS_SCAN_LIMIT.totalBytes,
    truncated: false,
  };

  if (request.args.includes(SKILL_CLI_FLAGS.disableSlashCommands)) {
    return boundedSkills([], false);
  }

  for (const root of skillRoots({ ...request, cwd: resolvedCwd, configDirectory: resolvedConfig })) {
    await scanSkillRoot(request, root, candidates, hidden, budget);
  }

  if (sourceEnabled(request.args, SKILL_SETTING_SOURCE.User)) {
    for (const plugin of await installedPluginSkillRoots({ ...request, configDirectory: resolvedConfig })) {
      await scanSkillRoot(
        request,
        {
          path: plugin.path,
          scope: join(resolvedConfig, 'plugins', 'cache'),
          priority: 300,
          kind: SKILL_ROOT_KIND.Skills,
        },
        candidates,
        hidden,
        budget,
        plugin.namespace,
      );
    }
  }

  for (const plugin of await cliPluginSkillRoots(
    request,
    argValues(request.args, SKILL_CLI_FLAGS.pluginDirectory),
  )) {
    const root: SkillRoot = {
      path: plugin.path,
      scope: dirname(plugin.path),
      priority: 400,
      kind: SKILL_ROOT_KIND.Skills,
    };

    await scanSkillRoot(request, root, candidates, hidden, budget, plugin.namespace);
  }

  return boundedSkills(candidates.values(), budget.truncated);
}
