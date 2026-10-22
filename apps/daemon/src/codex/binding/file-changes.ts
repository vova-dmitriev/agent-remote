import { CodexItemStatus, CodexItemType } from '../../domain/codex/codex.js';
import {
  FileChangeKind,
  MAX_RELAY_FRAME_BYTES,
  type AppSnapshot,
  type Session,
  type SessionChanges,
  type SessionFileChange,
} from '@protocol';
import { object } from '../events.js';
import { changeBytes, FileChangeLog } from '../../activity/file-changes.js';

const bytes = changeBytes;

/** These patches come only from the bound native thread; paths are display metadata, never file reads. */
export class CodexFileChanges extends FileChangeLog {
  ingest(raw: unknown, turnId: string, historical = false, at?: number) {
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

      if (
        typeof change.path !== 'string' ||
        typeof change.diff !== 'string' ||
        ![FileChangeKind.Add, FileChangeKind.Delete, FileChangeKind.Update].some(
          (candidateValue) => candidateValue === String(kind),
        )
      ) {
        continue;
      }

      this.add(
        {
          id: `${turnId}:${item.id}:${change.path}`,
          path: change.path,
          kind: kind as SessionFileChange['kind'],
          diff: change.diff,
          at,
        },
        historical,
      );
    }

    this.truncated ||= item.changes.length > 40;
  }
}

/** Share the transport budget across all owned sessions in the snapshot. */
/** All sessions' file changes in one snapshot: about ten sessions' worth at the per-session cap. */
const SNAPSHOT_CHANGES_BUDGET = 160_000;

export function boundChangeSnapshots(sessions: Session[], budget = SNAPSHOT_CHANGES_BUDGET): Session[] {
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

  // 64 KiB stay for the frame envelope and connector descriptors.
  const budget = Math.max(
    0,
    Math.min(SNAPSHOT_CHANGES_BUDGET, MAX_RELAY_FRAME_BYTES - 65536 - bytes(baseline)),
  );

  return { ...snapshot, sessions: boundChangeSnapshots(snapshot.sessions, budget) };
}
