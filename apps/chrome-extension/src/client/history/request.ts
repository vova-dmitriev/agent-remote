import { HistoryCursorPrefix, HistoryDirection, LocalOperation, eventSchema } from '@protocol';
import { z } from 'zod';
import type { ExtensionConnection } from '../connection.js';

const pageSchema = z.strictObject({
  events: z.array(eventSchema),
  before: z.string().nullable(),
  after: z.string().nullable(),
});

export async function requestHistory(
  connection: ExtensionConnection,
  sessionId: string,
  generation: string,
  query: string,
  observe: (response: Response) => void,
  cacheCursor = false,
) {
  const params = new URLSearchParams(query.split('?')[1] ?? query);

  let direction: HistoryDirection = HistoryDirection.Latest;

  for (const candidate of [HistoryDirection.Before, HistoryDirection.After, HistoryDirection.Around]) {
    if (params.has(candidate)) {
      direction = candidate;
      break;
    }
  }

  const rawAnchor = params.get(direction) ?? undefined;

  const anchor =
    rawAnchor && cacheCursor && !rawAnchor.startsWith(HistoryCursorPrefix.Cache)
      ? HistoryCursorPrefix.Cache + rawAnchor
      : rawAnchor;

  const position = params.get('position') ?? undefined;

  const page = pageSchema.parse(
    await connection.request({
      operation: LocalOperation.History,
      sessionId,
      generation,
      direction,
      ...(anchor ? { anchor } : {}),
      ...(position ? { position } : {}),
    }),
  );

  observe(
    new Response(null, {
      headers: { 'x-next-cursor': page.before ?? '', 'x-after-cursor': page.after ?? '' },
    }),
  );

  return page.events;
}
