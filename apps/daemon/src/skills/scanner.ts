import { join } from 'node:path';
import type { SessionSkill, SessionSkills } from '@protocol';
import { SESSION_SKILLS_LIMIT, SKILL_INVOCATION_PATTERN } from '@protocol';
import { parseSkillMetadata } from './metadata/frontmatter.js';
import { directory, entries, header } from './filesystem.js';
import { SKILL_FILE_NAMES, SKILL_ROOT_KIND, SKILLS_SCAN_LIMIT } from './values.js';
import type { CatalogRequest } from './filesystem.js';
import type { SkillRoot } from './sources.js';

type Candidate = { skill: SessionSkill; priority: number };

export async function scanSkillRoot(
  request: CatalogRequest,
  root: SkillRoot,
  candidates: Map<string, Candidate>,
  hidden: Set<string>,
  budget: { directories: number; bytes: number; truncated: boolean },
  namespace?: string,
): Promise<void> {
  const safeRoot = await directory(request, root.path, root.scope);

  if (!safeRoot) {
    return;
  }

  const visit = async (path: string, depth: number) => {
    if (depth > 4) {
      return;
    }

    if (budget.directories-- <= 0) {
      budget.truncated = true;

      return;
    }

    for (const entry of await entries(request, path)) {
      if (entry.isSymbolicLink()) {
        continue;
      }

      const child = join(path, entry.name);

      if (entry.isDirectory()) {
        const scoped = await directory(request, child, safeRoot);

        if (scoped) {
          const metadata = await header(request, join(scoped, SKILL_FILE_NAMES.skill), budget);

          if (metadata) {
            add(metadata, entry.name, namespace, root.priority, candidates, hidden);
          }

          await visit(scoped, depth + 1);
        }
      } else if (
        entry.isFile() &&
        root.kind === SKILL_ROOT_KIND.Commands &&
        entry.name.endsWith(SKILL_FILE_NAMES.legacyExtension)
      ) {
        const metadata = await header(request, child, budget);

        if (metadata) {
          add(
            metadata,
            entry.name.slice(0, -SKILL_FILE_NAMES.legacyExtension.length),
            namespace,
            root.priority,
            candidates,
            hidden,
          );
        }
      }
    }
  };

  await visit(safeRoot, 0);
}

function add(
  headerText: string,
  fallback: string,
  namespace: string | undefined,
  priority: number,
  candidates: Map<string, Candidate>,
  hidden: Set<string>,
) {
  const metadata = parseSkillMetadata(headerText, fallback);

  if (
    !metadata?.userInvocable ||
    hidden.has(metadata.name!) ||
    hidden.has(`${namespace ?? ''}:${metadata.name}`)
  ) {
    return;
  }

  const invocation = `/${namespace ? `${namespace}:` : ''}${metadata.name}`;

  if (!SKILL_INVOCATION_PATTERN.test(invocation)) {
    return;
  }

  const candidate = {
    skill: { name: metadata.name!, description: metadata.description!, invocation },
    priority,
  };

  const previous = candidates.get(invocation);

  if (!previous || priority > previous.priority) {
    candidates.set(invocation, candidate);
  }
}

function utf8Prefix(value: string, maxBytes: number): string {
  return Buffer.from(value, 'utf8')
    .subarray(0, maxBytes)
    .toString('utf8')
    .replace(/\uFFFD$/u, '');
}

export function boundedSkills(candidates: Iterable<Candidate>, truncated: boolean): SessionSkills {
  const result: SessionSkills = {
    sessionId: '',
    generation: '',
    supported: true,
    truncated,
    skills: [],
  };

  const sorted = [...candidates].sort((left, right) =>
    left.skill.invocation.localeCompare(right.skill.invocation),
  );

  const outputLimit = SKILLS_SCAN_LIMIT.responseBytes - 8192;
  const responseBudget = outputLimit - Buffer.byteLength(JSON.stringify(result));
  let used = Buffer.byteLength(JSON.stringify(result));

  for (const { skill } of sorted) {
    if (result.skills.length >= SESSION_SKILLS_LIMIT.maxCount) {
      result.truncated = true;
      break;
    }

    let description = utf8Prefix(skill.description, SESSION_SKILLS_LIMIT.maxDescriptionLength);
    let item = { ...skill, description };
    let itemBytes = Buffer.byteLength(JSON.stringify(item));

    while (itemBytes + used > outputLimit && description.length > 0) {
      description = utf8Prefix(description, Math.max(0, Buffer.byteLength(description) - 128));
      item = { ...skill, description };
      itemBytes = Buffer.byteLength(JSON.stringify(item));
      result.truncated = true;
    }

    if (!description || itemBytes > responseBudget || used + itemBytes > outputLimit) {
      result.truncated = true;
      continue;
    }

    result.skills.push(item);
    used += itemBytes;

    if (description !== skill.description) {
      result.truncated = true;
    }
  }

  if (sorted.length > result.skills.length) {
    result.truncated = true;
  }

  return result;
}
