import type { SessionFileChange } from "@protocol"

/** The most recently changed files first; the source lists them oldest first, which settles files without a time. */
export function newestChangesFirst(files: readonly SessionFileChange[]) {
  return files
    .map((file, index) => ({ file, index }))
    .sort((a, b) => (b.file.changedAt ?? 0) - (a.file.changedAt ?? 0) || b.index - a.index)
    .map(({ file }) => file)
}
