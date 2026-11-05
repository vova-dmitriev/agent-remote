import { constants, open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import {
  CodedError,
  ErrorCode,
  MAX_SESSION_FILE_BYTES,
  truncateUtf8,
  type Session,
  type SessionFile,
  type AttachmentDescriptor,
} from '@protocol';

interface SessionLookup {
  session(id: string): Session | undefined;
  /** The local images the agent named; without them only changed files open. */
  images?: {
    has(sessionId: string, path: string): boolean;
    open(session: Session, path: string): Promise<AttachmentDescriptor>;
  };
}

/**
 * The text of a file the session changed, for the app's file view. Only a path in the session's own change list is
 * read, never through a symlink, and only text; a large file comes back cut to its first 200 KB. A local image the
 * agent named in the session comes back as an attachment instead.
 */
export async function readSessionFile(
  monitor: SessionLookup,
  sessionId: string,
  path: string,
): Promise<SessionFile> {
  const session = monitor.session(sessionId);

  if (!session) {
    throw new CodedError(ErrorCode.NOT_FOUND);
  }

  if (!session.changes?.files.some((file) => file.path === path)) {
    if (monitor.images?.has(sessionId, path)) {
      return { path, content: '', truncated: false, attachment: await monitor.images.open(session, path) };
    }

    throw new CodedError(ErrorCode.ACCESS_DENIED);
  }

  const location = isAbsolute(path) ? path : session.cwd && resolve(session.cwd, path);

  if (!location) {
    throw new CodedError(ErrorCode.NOT_FOUND);
  }

  const file = await open(location, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => {
    throw new CodedError(ErrorCode.NOT_FOUND);
  });

  try {
    const info = await file.stat();

    if (!info.isFile()) {
      throw new CodedError(ErrorCode.NOT_FOUND);
    }

    const buffer = Buffer.alloc(Math.min(info.size, MAX_SESSION_FILE_BYTES));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);

    // A NUL byte means a binary file, which the view cannot show.
    if (bytes.includes(0)) {
      throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
    }

    const content = truncateUtf8(bytes.toString('utf8'), MAX_SESSION_FILE_BYTES);

    return { path, content, truncated: info.size > bytesRead };
  } finally {
    await file.close();
  }
}
