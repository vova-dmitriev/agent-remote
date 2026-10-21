import { join, isAbsolute } from 'node:path';
import { directory, entries, readJson } from '../filesystem.js';
import type { CatalogRequest } from '../filesystem.js';
import { SKILL_FILE_NAMES, SKILL_SETTINGS_FIELDS } from '../values.js';

export interface PluginSkillsRoot {
  path: string;
  namespace: string;
}

export async function installedPluginSkillRoots(request: CatalogRequest): Promise<PluginSkillsRoot[]> {
  const settings = await readJson(request, join(request.configDirectory, SKILL_FILE_NAMES.userSettings));
  const enabledValue = settings?.[SKILL_SETTINGS_FIELDS.enabledPlugins];

  if (!enabledValue || typeof enabledValue !== 'object' || Array.isArray(enabledValue)) {
    return [];
  }

  const enabled = Object.entries(enabledValue)
    .filter(([, value]) => value === true)
    .map(([name]) => name);

  if (!enabled.length) {
    return [];
  }

  const cache = await directory(
    request,
    join(request.configDirectory, SKILL_FILE_NAMES.pluginCache),
    request.configDirectory,
  );

  const registry = await readJson(request, join(request.configDirectory, SKILL_FILE_NAMES.installedPlugins));
  const plugins = registry?.plugins;

  if (!cache || !plugins || typeof plugins !== 'object' || Array.isArray(plugins)) {
    return [];
  }

  const roots: PluginSkillsRoot[] = [];

  for (const id of enabled) {
    const namespace = id.split('@')[0]!;

    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u.test(namespace)) {
      continue;
    }

    const installed = (plugins as Record<string, unknown>)[id];
    const entries = Array.isArray(installed) ? installed : [installed];

    for (const value of entries) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }

      const installPath = (value as Record<string, unknown>).installPath;

      if (typeof installPath !== 'string' || !isAbsolute(installPath)) {
        continue;
      }

      const installedRoot = await directory(request, installPath, cache);

      if (installedRoot) {
        roots.push({ path: join(installedRoot, SKILL_FILE_NAMES.skillsDirectory), namespace });
      }
    }
  }

  return roots;
}

export async function cliPluginSkillRoots(
  request: CatalogRequest,
  paths: readonly string[],
): Promise<PluginSkillsRoot[]> {
  const roots: PluginSkillsRoot[] = [];

  for (const supplied of paths) {
    if (!isAbsolute(supplied)) {
      continue;
    }

    const root = await directory(request, supplied, supplied);

    if (!root) {
      continue;
    }

    const direct = await descriptor(request, root);

    if (direct) {
      roots.push(direct);
    }

    for (const entry of await entries(request, root)) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }

      const child = await directory(request, join(root, entry.name), root);

      if (!child) {
        continue;
      }

      const plugin = await descriptor(request, child);

      if (plugin) {
        roots.push(plugin);
      }
    }
  }

  return roots;
}

async function descriptor(request: CatalogRequest, root: string): Promise<PluginSkillsRoot | undefined> {
  const data = await readJson(request, join(root, SKILL_FILE_NAMES.pluginDescriptor), 16384);
  const name = data?.name;

  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u.test(name)) {
    return undefined;
  }

  return { path: join(root, SKILL_FILE_NAMES.skillsDirectory), namespace: name };
}
