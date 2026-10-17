import { CodexItemStatus, CodexItemType } from '../domain/codex.js';
import {
  FileChangeKind,
  type AppSnapshot,
  type Session,
  type SessionChanges,
  type SessionFileChange,
  truncateUtf8,
} from '../../../../packages/protocol/src/index.js';
import { object } from './events.js';

const SESSION_BUDGET = 16384;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/** These patches come only from the bound native thread; paths are display metadata, never file reads. */
export class CodexFileChanges {
  private files = new Map<string, SessionFileChange>();
  private truncated = false;

  ingest(raw: unknown, turnId: string, historical = false) {
    const item = object(raw);

    if (
      item.type !== CodexItemType.FileChange ||
      item.status !== CodexItemStatus.Completed ||
      typeof item.id !== 'string' ||
      !Array.isArray(item.changes)
    ) {
      return;
    }

    for (const rawChange of item.changes.slice(0, 40)) {
      const change = object(rawChange);
      const kind = object(change.kind).type;
      const id = `${turnId}:${item.id}:${change.path}`;

      if (
        typeof change.path !== 'string' ||
        !change.path ||
        change.path.length > 4096 ||
        typeof change.diff !== 'string' ||
        ![FileChangeKind.Add, FileChangeKind.Delete, FileChangeKind.Update].some(
          (candidateValue) => candidateValue === String(kind),
        ) ||
        id.length > 2048 ||
        (historical && this.files.has(id))
      ) {
        continue;
      }

      let patch = truncateUtf8(change.diff, 12000);

      const file: SessionFileChange = {
        id,
        path: change.path,
        kind: kind as SessionFileChange['kind'],
        patch,
        truncated: patch !== change.diff,
      };

      while (bytes(file) > 14000 && patch) {
        patch = patch.slice(0, Math.floor(patch.length * 0.8));
        file.patch = patch;
        file.truncated = true;
      }

      this.files.set(id, file);
      this.truncated ||= file.truncated || item.changes.length > 40;

      while (this.files.size > 40 || bytes(this.value()) > SESSION_BUDGET) {
        this.files.delete(this.files.keys().next().value!);
        this.truncated = true;
      }
    }
  }

  value(): SessionChanges {
    return { files: [...this.files.values()], truncated: this.truncated };
  }
}

/** Share the transport budget across all owned sessions in the snapshot. */
export function boundChangeSnapshots(sessions: Session[], budget = 24000): Session[] {
  let remaining = budget;

  return sessions.map((session) => {
    if (!session.changes) {
      return session;
    }

    const changes: SessionChanges = { files: [], truncated: session.changes.truncated };

    for (const file of session.changes.files) {
      const size = bytes(file);

      if (size > remaining) {
        changes.truncated = true;
        continue;
      }

      remaining -= size;
      changes.files.push(file);
    }

    return { ...session, changes };
  });
}

/** Reserve space for the relay frame and connector descriptors without displacing existing content. */
export function boundSnapshotChanges(snapshot: AppSnapshot): AppSnapshot {
  const baseline = {
    ...snapshot,
    sessions: snapshot.sessions.map((session) =>
      session.changes ? { ...session, changes: { files: [], truncated: true } } : session,
    ),
  };

  const budget = Math.max(0, Math.min(24000, 114688 - bytes(baseline)));

  return { ...snapshot, sessions: boundChangeSnapshots(snapshot.sessions, budget) };
}
