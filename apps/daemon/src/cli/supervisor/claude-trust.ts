import { readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

type ClaudeConfig = { projects?: Record<string, Record<string, unknown>> } & Record<string, unknown>;

/**
 * Marks a shared VM's projects root as trusted in Claude Code's config. Claude asks "Do you trust the files in this
 * folder?" in every new project, with No focused, which would stop a session started from the app; trust given to
 * a parent folder covers the projects under it. Returns whether it changed the config; leaves an unreadable one.
 */
export async function trustProjectsRoot(configPath: string, root: string): Promise<boolean> {
  const text = await readFile(configPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return '{}';
    }

    throw error;
  });

  const config = JSON.parse(text) as ClaudeConfig;

  if (config.projects?.[root]?.hasTrustDialogAccepted === true) {
    return false;
  }

  const next = {
    ...config,
    projects: { ...config.projects, [root]: { ...config.projects?.[root], hasTrustDialogAccepted: true } },
  };

  // Claude rewrites this file itself: replace it in one step, never half-written.
  const temporary = `${configPath}.${randomBytes(6).toString('hex')}`;

  await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
  await rename(temporary, configPath);

  return true;
}
