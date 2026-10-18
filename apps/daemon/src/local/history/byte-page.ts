import { ErrorCode, HistoryDirection, LOCAL_LIMITS } from '../../../../../packages/protocol/src/index.js';

export const LOCAL_HISTORY_LIMITS = {
  // Leave room for result metadata and both cursors within the logical-message ceiling.
  pageBytes: LOCAL_LIMITS.logicalBytes - LOCAL_LIMITS.frameBytes,
} as const;

export function bytePage<T>(items: readonly T[], direction: HistoryDirection, anchor = -1) {
  if (!items.length) {
    return { start: 0, end: 0 };
  }

  const sizes = items.map((item) => Buffer.byteLength(JSON.stringify(item), 'utf8') + 1);
  const around = direction === HistoryDirection.Around && anchor >= 0;
  const forward = direction === HistoryDirection.After;
  let start = forward ? 0 : items.length - 1;

  if (around) {
    start = anchor;
  }

  let end = start + 1;
  let bytes = sizes[start]!;

  if (bytes > LOCAL_HISTORY_LIMITS.pageBytes) {
    throw new Error(ErrorCode.LOCAL_PAYLOAD_TOO_LARGE);
  }

  let before = !forward;
  let after = forward || around;

  while (before || after) {
    if (before) {
      before = start > 0 && bytes + sizes[start - 1]! <= LOCAL_HISTORY_LIMITS.pageBytes;

      if (before) {
        bytes += sizes[--start]!;
      }
    }

    if (after) {
      after = end < items.length && bytes + sizes[end]! <= LOCAL_HISTORY_LIMITS.pageBytes;

      if (after) {
        bytes += sizes[end++]!;
      }
    }
  }

  return { start, end };
}
