import { type SessionChanges, type SessionFileChange, truncateUtf8 } from '@protocol';

const SESSION_BUDGET = 16384;

export const changeBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

export interface FileEdit {
  id: string;
  path: string;
  kind: SessionFileChange['kind'];
  diff: string;
  /** When the agent made the edit, in milliseconds. */
  at?: number | undefined;
}

/**
 * A session's latest file edits, bounded to 40 files and the snapshot budget. Over budget, the oldest edits lose
 * their patch first, so the files stay listed (and openable); only then do the oldest go.
 */
export class FileChangeLog {
  private files = new Map<string, SessionFileChange>();
  protected truncated = false;

  /** `historical` edits re-read from history never replace one already listed. */
  add(edit: FileEdit, historical = false) {
    if (
      edit.id.length > 2048 ||
      !edit.path ||
      edit.path.length > 4096 ||
      (historical && this.files.has(edit.id))
    ) {
      return;
    }

    let patch = truncateUtf8(edit.diff, 12000);

    const file: SessionFileChange = {
      id: edit.id,
      path: edit.path,
      kind: edit.kind,
      patch,
      truncated: patch !== edit.diff,
      ...(edit.at ? { changedAt: edit.at } : {}),
    };

    while (changeBytes(file) > 14000 && patch) {
      patch = patch.slice(0, Math.floor(patch.length * 0.8));
      file.patch = patch;
      file.truncated = true;
    }

    this.files.delete(file.id);
    this.files.set(file.id, file);
    this.truncated ||= file.truncated;

    while (this.files.size > 40) {
      this.files.delete(this.files.keys().next().value!);
      this.truncated = true;
    }

    while (changeBytes(this.value()) > SESSION_BUDGET) {
      const oldest = [...this.files.values()].find((item) => item.patch);

      if (oldest && oldest !== file) {
        oldest.patch = '';
        oldest.truncated = true;
      } else {
        this.files.delete(this.files.keys().next().value!);
      }

      this.truncated = true;
    }
  }

  get size() {
    return this.files.size;
  }

  reset() {
    this.files.clear();
    this.truncated = false;
  }

  value(): SessionChanges {
    return { files: [...this.files.values()], truncated: this.truncated };
  }
}
