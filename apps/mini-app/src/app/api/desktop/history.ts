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

/** Per-generation paging state, matching the web HistoryWindow: cursors, in-flight directions and exhausted edges. */
interface HistoryWindowState extends Pick<HistoryPage, HistoryPageDirection> {
  generation: string
  busy: Set<HistoryPageDirection>
  exhausted: Set<string>
}

const EXHAUSTED_EDGE_LIMIT = 4

/** A loaded message position names the same native source offset the daemon accepts as a page cursor. */
function edgeCursor(edge: string) {
  return edge.startsWith(HistoryCursorPrefix.Position) ? HistoryCursorPrefix.Source + edge.slice(HistoryCursorPrefix.Position.length) : edge
}

function historyCursor(event: EventEnvelope) {
  return (event.payload as { historyCursor?: string }).historyCursor
}

export class DesktopHistory {
  private generations = new Map<string, string>()
  private windows = new Map<string, HistoryWindowState>()

  constructor(
    private readonly connection: DesktopBridgeConnection,
    private readonly handlers: TransportHandlers,
  ) {}

  observe(frame: ServerFrame): void {
    if (frame.type !== FrameType.Snapshot) return

    for (const session of frame.snapshot.sessions) this.generations.set(session.id, session.generation)
  }

  async load(sessionId: string): Promise<EventEnvelope[] | null> {
    const window = this.window(sessionId)
    const page = await this.request(sessionId, HistoryDirection.Latest)

    if (page && window) {
      window.before = page.before
      window.after = page.after
      window.exhausted.clear()
    }

    return page?.events ?? null
  }

  async page(sessionId: string, direction: HistoryPageDirection, edge?: string): Promise<EventEnvelope[] | null> {
    const window = this.window(sessionId)
    const cursor = edge ? edgeCursor(edge) : window?.[direction]
    const key = direction + ":" + cursor

    if (!window || !cursor || window.busy.has(direction) || window.exhausted.has(key)) return null
    window.busy.add(direction)

    try {
      const page = await this.request(sessionId, direction, cursor)

      if (!page) return null
      window[direction] = page[direction]

      if (!page.events.length || (edge && page.events.every((event) => historyCursor(event) === edge))) window.exhausted.add(key)
      if (window.exhausted.size > EXHAUSTED_EDGE_LIMIT) window.exhausted.delete(window.exhausted.values().next().value!)

      return page.events
    } finally {
      window.busy.delete(direction)
    }
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

    return page
  }

  /** The paging state of the session's current generation; a new generation starts empty. */
  private window(sessionId: string) {
    const generation = this.generations.get(sessionId)

    if (!generation) return undefined
    const current = this.windows.get(sessionId)

    if (current?.generation === generation) return current
    const created: HistoryWindowState = { generation, before: null, after: null, busy: new Set(), exhausted: new Set() }

    this.windows.set(sessionId, created)

    return created
  }
}
