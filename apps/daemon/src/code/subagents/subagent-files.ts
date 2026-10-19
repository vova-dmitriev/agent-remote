import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { z } from 'zod';
import { CodedError, ErrorCode, SUBAGENT_ID_PATTERN } from '@protocol';
import { DaemonErrorCode } from '../../error-codes.js';
import type { BackfilledSubagent } from '../../activity/subagents.js';

/** Claude's per-session layout: `<transcript dir>/<session id>/subagents/agent-<agent id>.{jsonl,meta.json}`. */
const SubagentFile = {
  Directory: 'subagents',
  Prefix: 'agent-',
  Transcript: '.jsonl',
  Meta: '.meta.json',
} as const;

const SUBAGENT_META_MAX_BYTES = 64 * 1024;
const SUBAGENT_BACKFILL_LIMIT = 50;

const metaSchema = z.object({
  agentType: z.string().trim().min(1).max(256).optional().catch(undefined),
  description: z.string().trim().min(1).max(4096).optional().catch(undefined),
  model: z.string().trim().min(1).max(256).optional().catch(undefined),
  finished: z.boolean().optional().catch(undefined),
});

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

function inside(root: string, path: string) {
  const within = relative(root, path);

  return within !== '' && within !== '..' && !within.startsWith('../') && !isAbsolute(within);
}

/**
 * The owning session's real `subagents` directory, or `undefined` when it does not exist. The directory must
 * sit exactly under the session's transcript directory (no symlinked component) and inside `allowedRoot`.
 */
export async function subagentDirectory(
  parentTranscript: string,
  claudeSessionId: string,
  allowedRoot: string,
) {
  if (!SUBAGENT_ID_PATTERN.test(claudeSessionId)) {
    throw new CodedError(DaemonErrorCode.INVALID_TRANSCRIPT_PATH);
  }

  let root: string, parent: string, resolved: string;

  try {
    [root, parent, resolved] = await Promise.all([
      realpath(allowedRoot),
      realpath(dirname(parentTranscript)),
      realpath(join(dirname(parentTranscript), claudeSessionId, SubagentFile.Directory)),
    ]);
  } catch (error) {
    if (missing(error)) {
      return;
    }

    throw error;
  }

  if (resolved !== join(parent, claudeSessionId, SubagentFile.Directory) || !inside(root, resolved)) {
    throw new CodedError(DaemonErrorCode.TRANSCRIPT_OUTSIDE_ROOT);
  }

  return resolved;
}

/** The transcript path of one child, built only from a validated id; never from a client-supplied path. */
export function subagentTranscriptPath(directory: string, agentId: string) {
  if (!SUBAGENT_ID_PATTERN.test(agentId)) {
    throw new CodedError(ErrorCode.NOT_FOUND);
  }

  return join(directory, SubagentFile.Prefix + agentId + SubagentFile.Transcript);
}

/** Modification time of a regular, non-symlinked file; `undefined` for anything else. */
async function regularFileTime(path: string) {
  try {
    const info = await lstat(path);

    return info.isFile() && !info.isSymbolicLink() ? info.mtimeMs : undefined;
  } catch {
    return undefined;
  }
}

async function readMeta(path: string) {
  let file;

  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return;
  }

  try {
    const info = await file.stat();

    if (!info.isFile() || info.size > SUBAGENT_META_MAX_BYTES) {
      return;
    }

    // At most the checked size plus one byte, which detects a file that grew after the check.
    const buffer = Buffer.alloc(info.size + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);

    if (bytesRead > info.size) {
      return;
    }

    const parsed = metaSchema.safeParse(JSON.parse(buffer.toString('utf8', 0, bytesRead)));

    return parsed.success ? parsed.data : undefined;
  } catch {
    return;
  } finally {
    await file.close();
  }
}

/** Children described by `agent-<id>.meta.json` files, newest first, capped at the per-session limit. */
export async function listSubagentFiles(directory: string): Promise<BackfilledSubagent[]> {
  const ids = (await readdir(directory)).flatMap((name) => {
    const id = name.slice(SubagentFile.Prefix.length, -SubagentFile.Meta.length);

    return name.startsWith(SubagentFile.Prefix) &&
      name.endsWith(SubagentFile.Meta) &&
      SUBAGENT_ID_PATTERN.test(id)
      ? [id]
      : [];
  });

  const dated = await Promise.all(
    ids.map(async (id) => ({
      id,
      metaTime: await regularFileTime(join(directory, SubagentFile.Prefix + id + SubagentFile.Meta)),
    })),
  );

  const newest = dated
    .filter((entry): entry is { id: string; metaTime: number } => entry.metaTime !== undefined)
    .sort((a, b) => b.metaTime - a.metaTime)
    .slice(0, SUBAGENT_BACKFILL_LIMIT);

  const children = await Promise.all(
    newest.map(async ({ id, metaTime }): Promise<BackfilledSubagent | undefined> => {
      const meta = await readMeta(join(directory, SubagentFile.Prefix + id + SubagentFile.Meta));

      if (!meta) {
        return;
      }

      const transcriptTime = await regularFileTime(subagentTranscriptPath(directory, id));

      return {
        id,
        type: meta.agentType,
        description: meta.description,
        model: meta.model,
        finished: meta.finished === true,
        transcriptAvailable: transcriptTime !== undefined,
        updatedAt: Math.trunc(Math.max(metaTime, transcriptTime ?? 0)),
      };
    }),
  );

  return children.filter((child): child is BackfilledSubagent => !!child);
}
