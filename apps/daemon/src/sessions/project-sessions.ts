import { CodedError, type Command, CommandActionType, ErrorCode, type ProjectSession } from '@protocol';
import { readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectSessionsPort } from '../domain/ports/session-names.js';
import { logDebug } from '../diagnostics/log.js';

type CreateAction = Extract<Command['action'], { type: typeof CommandActionType.CreateSession }>;

/** The most projects the snapshot lists. */
const MAX_PROJECTS = 200;

interface ProjectSessionsDeps {
  /** The directory whose subdirectories are the projects (REMOTE_PROJECTS_ROOT); none offers no projects. */
  root: string | undefined;
  monitor: { setProjects(paths: string[]): void };
  create: (action: CreateAction) => Promise<string>;
}

/**
 * The projects of a shared machine (a Linux VM) that an owner can start a session in before having any session
 * there: the root's subdirectories, listed on the snapshot. A session starts only in a listed project.
 */
export class ProjectSessions implements ProjectSessionsPort {
  private projects: readonly string[] = [];

  constructor(private readonly deps: ProjectSessionsDeps) {}

  async refresh() {
    const { root, monitor } = this.deps;

    if (!root) {
      return;
    }

    try {
      const entries = await readdir(root, { withFileTypes: true });

      const directories = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => join(root, entry.name));

      this.projects = (await Promise.all(directories.map((path) => realpath(path))))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, MAX_PROJECTS);
    } catch (error) {
      logDebug('sessions/project-sessions', error);
      this.projects = [];
    }

    monitor.setProjects([...this.projects]);
  }

  async create(session: ProjectSession): Promise<string> {
    // The real path: a path through `..` or a link reaches a listed project only if it is one.
    const cwd = await realpath(session.cwd).catch(() => undefined); // ignore: a missing directory is no listed project

    if (!cwd || !this.projects.includes(cwd)) {
      throw new CodedError(ErrorCode.INVALID_PROJECT);
    }

    return this.deps.create({
      type: CommandActionType.CreateSession,
      provider: session.provider,
      cwd,
      ...(session.model ? { model: session.model } : {}),
    });
  }
}
