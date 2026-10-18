import { CheckpointError, checkpointFailure } from './values.js';
import type { CheckpointMessage, CheckpointSource, SourceFence } from './types.js';
import { assertCurrent, cleanMessage, normalizeFence, visibleMessage } from './values.js';

export async function pageSelectedMessages(
  source: CheckpointSource,
  selected: ReadonlySet<string>,
  initial: SourceFence,
  pageSize: number,
  maxPages: number,
) {
  const found = new Map<string, CheckpointMessage>();
  let anchor: string | undefined;
  let pages = 0;
  let hasMore = true;

  while (hasMore && found.size < selected.size && pages < maxPages) {
    assertCurrent(normalizeFence(await source.captureFence()), initial);

    const page = await source.page({
      ...(anchor ? { anchor } : {}),
      limit: pageSize,
      watermark: initial.historyWatermark,
    });

    assertCurrent(normalizeFence(await source.captureFence()), initial);

    if (page.messages.length > pageSize) {
      throw checkpointFailure(CheckpointError.PageLimitExceeded);
    }

    for (const message of page.messages) {
      if (visibleMessage(message) && selected.has(message.id) && typeof message.text === 'string') {
        found.set(message.id, cleanMessage(message));
      }
    }

    if (page.nextAnchor === anchor || (page.hasMore && !page.nextAnchor)) {
      throw checkpointFailure(CheckpointError.PageCursorInvalid);
    }

    anchor = page.nextAnchor ?? undefined;
    hasMore = page.hasMore;
    pages++;
  }

  return { found, pages, hasMore };
}
