import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { CatalogRequest } from './filesystem.js';
import { readJson } from './filesystem.js';
import {
  SKILL_CLI_FLAGS,
  SKILL_FILE_NAMES,
  SKILL_OVERRIDE_STATE,
  SKILL_ROOT_KIND,
  SKILL_SETTING_SOURCE,
  SKILL_SETTINGS_FIELDS,
} from './values.js';

export type SkillRootKind = (typeof SKILL_ROOT_KIND)[keyof typeof SKILL_ROOT_KIND];
export type SkillSettingSource = (typeof SKILL_SETTING_SOURCE)[keyof typeof SKILL_SETTING_SOURCE];

export interface SkillRoot {
  path: string;
  scope: string;
  priority: number;
  kind: SkillRootKind;
}

export function argValues(args: readonly string[], flag: string): string[] {
  const values: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;

    if (arg === flag && args[index + 1]) {
      values.push(args[++index]!);
    } else if (arg.startsWith(`${flag}=`)) {
      values.push(arg.slice(flag.length + 1));
    }
  }

  return values;
}

export function sourceEnabled(args: readonly string[], source: SkillSettingSource): boolean {
  const sources = argValues(args, SKILL_CLI_FLAGS.settingSources).at(-1);

  return (
    sources === undefined ||
    sources
      .split(',')
      .map((value) => value.trim())
      .includes(source)
  );
}

function ancestors(path: string): string[] {
  const values: string[] = [];

  for (let parent = dirname(path); parent !== dirname(parent); parent = dirname(parent)) {
    values.push(parent);
  }

  return values;
}

export function skillRoots(request: CatalogRequest): SkillRoot[] {
  const result: SkillRoot[] = [];

  if (sourceEnabled(request.args, SKILL_SETTING_SOURCE.User)) {
    result.push({
      path: join(request.configDirectory, SKILL_FILE_NAMES.skillsDirectory),
      scope: request.configDirectory,
      priority: 300,
      kind: SKILL_ROOT_KIND.Skills,
    });

    result.push({
      path: join(request.configDirectory, SKILL_FILE_NAMES.userCommands),
      scope: request.configDirectory,
      priority: 300,
      kind: SKILL_ROOT_KIND.Commands,
    });
  }

  if (!sourceEnabled(request.args, SKILL_SETTING_SOURCE.Project)) {
    return result;
  }

  const paths = [resolve(request.cwd), ...ancestors(resolve(request.cwd))];

  for (let index = paths.length - 1; index >= 0; index--) {
    const path = paths[index]!;
    const priority = 200 + paths.length - index;

    result.push({
      path: join(path, SKILL_FILE_NAMES.userSkills),
      scope: path,
      priority,
      kind: SKILL_ROOT_KIND.Skills,
    });

    result.push({
      path: join(path, SKILL_FILE_NAMES.projectCommands),
      scope: path,
      priority,
      kind: SKILL_ROOT_KIND.Commands,
    });
  }

  for (const extra of argValues(request.args, SKILL_CLI_FLAGS.addDirectory)) {
    if (!isAbsolute(extra)) {
      continue;
    }

    result.push({
      path: join(extra, SKILL_FILE_NAMES.userSkills),
      scope: extra,
      priority: 210,
      kind: SKILL_ROOT_KIND.Skills,
    });

    result.push({
      path: join(extra, SKILL_FILE_NAMES.projectCommands),
      scope: extra,
      priority: 210,
      kind: SKILL_ROOT_KIND.Commands,
    });
  }

  return result;
}

export async function hiddenSkillNames(request: CatalogRequest, cwd: string): Promise<Set<string>> {
  const effective = new Map<string, unknown>();
  const paths: string[] = [];

  if (sourceEnabled(request.args, SKILL_SETTING_SOURCE.User)) {
    paths.push(
      join(request.configDirectory, SKILL_FILE_NAMES.userSettings),
      join(request.configDirectory, SKILL_FILE_NAMES.localSettings),
    );
  }

  if (sourceEnabled(request.args, SKILL_SETTING_SOURCE.Project)) {
    for (const parent of [...ancestors(resolve(cwd)).reverse(), resolve(cwd)]) {
      paths.push(
        join(parent, SKILL_FILE_NAMES.claudeDirectory, SKILL_FILE_NAMES.userSettings),
        join(parent, SKILL_FILE_NAMES.claudeDirectory, SKILL_FILE_NAMES.localSettings),
      );
    }
  }

  for (const path of paths) {
    const data = await readJson(request, path);
    const value = data?.[SKILL_SETTINGS_FIELDS.invocationOverrides];

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [name, mode] of Object.entries(value)) {
        effective.set(name, mode);
      }
    }
  }

  return new Set(
    [...effective].filter(([, mode]) => mode === SKILL_OVERRIDE_STATE.Off).map(([name]) => name),
  );
}
