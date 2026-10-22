import { open, readdir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import Sqlite from 'better-sqlite3';
import { logDebug } from '../../diagnostics/log.js';

/** The most folders offered, and how much of a transcript's start is read for its folder. */
const RecentFolderLimit = { Folders: 50, HeadBytes: 65_536, CodexThreads: 500 } as const;

const CWD_FIELD = /"cwd":"((?:[^"\\]|\\.)*)"/u;

interface RecentFolderSources {
  /** Claude Code's config directory (`~/.claude`), whose `projects` hold the transcripts. */
  claudeDirectory: string;
  /** Codex's home (`~/.codex`), whose state database lists the threads. */
  codexHome: string;
}

/** The folder of each Claude project's newest transcript, with the transcript's time. */
async function claudeFolders(directory: string) {
  const root = join(directory, 'projects');
  const found: [string, number][] = [];

  for (const project of await readdir(root).catch(() => [])) {
    const files = await readdir(join(root, project)).catch(() => []);

    const transcripts = await Promise.all(
      files
        .filter((name) => name.endsWith('.jsonl'))
        .map(async (name) => ({
          path: join(root, project, name),
          at: (await stat(join(root, project, name))).mtimeMs,
        })),
    );

    const newest = transcripts.sort((a, b) => b.at - a.at)[0];

    if (!newest) {
      continue;
    }

    const handle = await open(newest.path, 'r');

    try {
      const { buffer, bytesRead } = await handle.read(
        Buffer.alloc(RecentFolderLimit.HeadBytes),
        0,
        RecentFolderLimit.HeadBytes,
        0,
      );

      const cwd = CWD_FIELD.exec(buffer.subarray(0, bytesRead).toString('utf8'))?.[1];

      if (cwd) {
        found.push([JSON.parse(`"${cwd}"`) as string, newest.at]);
      }
    } finally {
      await handle.close();
    }
  }

  return found;
}

/** The folders of Codex's unarchived threads, with their newest thread's time. */
async function codexFolders(home: string) {
  const state = (await readdir(home).catch(() => []))
    .filter((name) => /^state_\d+\.sqlite$/u.test(name))
    .sort((a, b) => Number(b.match(/\d+/u)![0]) - Number(a.match(/\d+/u)![0]))[0];

  if (!state) {
    return [];
  }

  const db = new Sqlite(join(home, state), { readonly: true, fileMustExist: true });

  try {
    return (
      db
        .prepare(
          "SELECT cwd, max(updated_at_ms) AS at FROM threads WHERE archived=0 AND cwd<>'' GROUP BY cwd ORDER BY at DESC LIMIT ?",
        )
        .all(RecentFolderLimit.CodexThreads) as { cwd: string; at: number }[]
    ).map((row): [string, number] => [row.cwd, row.at]);
  } finally {
    db.close();
  }
}

/**
 * The folders a Mac's owner has worked in with Claude Code or Codex, newest first: where a new session can start
 * though no session runs there now. Only folders that still exist, by their real path.
 */
export async function recentFolders(sources: RecentFolderSources): Promise<string[]> {
  const times = new Map<string, number>();

  const found = await Promise.all([
    claudeFolders(sources.claudeDirectory),
    codexFolders(sources.codexHome).catch((error: unknown) => {
      logDebug('sessions/recent-folders', error);

      return [];
    }),
  ]);

  for (const [folder, at] of found.flat()) {
    const real = await realpath(folder).catch(() => undefined); // ignore: a removed folder is not offered

    if (real && (await stat(real)).isDirectory()) {
      times.set(real, Math.max(at, times.get(real) ?? 0));
    }
  }

  return [...times]
    .sort((a, b) => b[1] - a[1])
    .slice(0, RecentFolderLimit.Folders)
    .map(([folder]) => folder);
}
