import { z } from "zod"
import {
  FrameType,
  HistoryCursorPrefix,
  HistoryDirection,
  LocalOperation,
  eventSchema,
  type EventEnvelope,
  type HistoryPageDirection,
  type ServerFrame,
} from "@protocol"
import type { TransportHandlers } from "@/shared/api"
import type { DesktopBridgeConnection } from "./desktop-connection.js"

const pageSchema = z.strictObject({ events: z.array(eventSchema), before: z.string().nullable(), after: z.string().nullable() })

type HistoryPage = z.infer<typeof pageSchema>
type HistoryCursors = Pick<HistoryPage, HistoryPageDirection> & { generation: string }

/** A loaded message position names the same native source offset the daemon accepts as a page cursor. */
function edgeCursor(edge: string) {
  return edge.startsWith(HistoryCursorPrefix.Position) ? HistoryCursorPrefix.Source + edge.slice(HistoryCursorPrefix.Position.length) : edge
}

export class DesktopHistory {
  private generations = new Map<string, string>()
  private cursors = new Map<string, HistoryCursors>()

  constructor(
    private readonly connection: DesktopBridgeConnection,
    private readonly handlers: TransportHandlers,
  ) {}

  observe(frame: ServerFrame): void {
    if (frame.type !== FrameType.Snapshot) return

    for (const session of frame.snapshot.sessions) this.generations.set(session.id, session.generation)
  }

  async load(sessionId: string): Promise<EventEnvelope[] | null> {
    const page = await this.request(sessionId, HistoryDirection.Latest)

    if (page) this.cursors.set(sessionId, { before: page.before, after: page.after, generation: page.generation })

    return page?.events ?? null
  }

  async page(sessionId: string, direction: HistoryPageDirection, edge?: string): Promise<EventEnvelope[] | null> {
    const cursors = this.currentCursors(sessionId)
    const cursor = edge ? edgeCursor(edge) : cursors?.[direction]

    if (!cursor) return null

    const page = await this.request(sessionId, direction, cursor)

    if (page && cursors?.generation === page.generation) cursors[direction] = page[direction]

    return page?.events ?? null
  }

  private async request(sessionId: string, direction: HistoryDirection, anchor?: string) {
    const generation = this.generations.get(sessionId)

    if (!generation) return null

    const page = pageSchema.parse(
      await this.connection.request({
        operation: LocalOperation.History,
        sessionId,
        generation,
        direction,
        ...(anchor ? { anchor } : {}),
      }),
    )

    this.handlers.onHistory?.(sessionId, page.events)

    return { ...page, generation }
  }

  private currentCursors(sessionId: string) {
    const cursors = this.cursors.get(sessionId)

    return cursors && cursors.generation === this.generations.get(sessionId) ? cursors : undefined
  }
}
