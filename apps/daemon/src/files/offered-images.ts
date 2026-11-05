import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import {
  CodedError,
  ErrorCode,
  MessageRole,
  localImagePaths,
  type AttachmentDescriptor,
  type HistoryMessage,
  type Session,
} from '@protocol';

type ExportImage = (session: Session, path: string, name: string) => Promise<AttachmentDescriptor>;

/**
 * The local images the agent named in a session's messages: the only paths the app may open as images. Opening one
 * exports it as an attachment; nothing leaves the device before the owner opens it.
 * ponytail: kept in memory, so a path named before a daemon restart opens once its message is read again.
 */
export class OfferedImages {
  private sessions = new Map<string, Set<string>>();
  constructor(private exportImage?: ExportImage) {}
  offer(sessionId: string, message: HistoryMessage) {
    if (message.role !== MessageRole.Assistant) {
      return;
    }

    for (const path of localImagePaths(message.text)) {
      const paths = this.sessions.get(sessionId) ?? new Set<string>();

      paths.delete(path);
      paths.add(path);

      if (paths.size > 200) {
        paths.delete(paths.values().next().value!);
      }

      this.sessions.delete(sessionId);
      this.sessions.set(sessionId, paths);

      if (this.sessions.size > 500) {
        this.sessions.delete(this.sessions.keys().next().value!);
      }
    }
  }
  has(sessionId: string, path: string) {
    return this.sessions.get(sessionId)?.has(path) === true;
  }
  /** Exports a named image; a path the agent did not name in this session is refused. */
  open(session: Session, path: string) {
    if (!this.exportImage || !this.has(session.id, path)) {
      return Promise.reject(new CodedError(ErrorCode.ACCESS_DENIED));
    }

    const location = path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;

    return this.exportImage(session, location, basename(location));
  }
}
