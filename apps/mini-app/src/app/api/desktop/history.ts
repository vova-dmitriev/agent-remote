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
import { HistoryPageSkip, type TransportHandlers } from "@/shared/api"
import type { DesktopBridgeConnection } from "./desktop-connection.js"

const pageSchema = z.strictObject({ events: z.array(eventSchema), before: z.string().nullable(), after: z.string().nullable() })

type HistoryPage = z.infer<typeof pageSchema>

/** Per-generation paging state, matching the web HistoryWindow: cursors, in-flight directions and exhausted edges. A subagent's transcript has its own state. */
interface HistoryWindowState extends Pick<HistoryPage, HistoryPageDirection> {
  generation: string
  busy: Set<HistoryPageDirection>
  exhausted: Set<string>
  /** Whether a latest load reported this generation's cursors; before that a missing cursor proves nothing. */
  loaded: boolean
}

const EXHAUSTED_EDGE_LIMIT = 4

/** A loaded message position names the same native source offset the daemon accepts as a page cursor. */
function edgeCursor(edge: string) {
  return edge.startsWith(HistoryCursorPrefix.Position) ? HistoryCursorPrefix.Source + edge.slice(HistoryCursorPrefix.Position.length) : edge
}

function historyCursor(event: EventEnvelope) {
  return (event.payload as { historyCursor?: string }).historyCursor
}

/** Window key: the session itself, or one of its subagents. */
function windowKey(sessionId: string, agentId?: string) {
  return agentId ? sessionId + "\u0000" + agentId : sessionId
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

  async load(sessionId: string, agentId?: string): Promise<EventEnvelope[] | null> {
    const window = this.window(sessionId, agentId)
    const page = await this.request(sessionId, HistoryDirection.Latest, undefined, agentId)

    if (page && window) {
      window.before = page.before
      window.after = page.after
      window.exhausted.clear()
      window.loaded = true
    }

    return page?.events ?? null
  }

  async page(
    sessionId: string,
    direction: HistoryPageDirection,
    edge?: string,
    agentId?: string,
  ): Promise<EventEnvelope[] | HistoryPageSkip> {
    const window = this.window(sessionId, agentId)
    const cursor = edge ? edgeCursor(edge) : window?.[direction]
    const key = direction + ":" + cursor

    if (!window || (!cursor && !window.loaded)) return HistoryPageSkip.Stale
    if (!cursor || window.exhausted.has(key)) return HistoryPageSkip.Exhausted
    if (window.busy.has(direction)) return HistoryPageSkip.Busy
    window.busy.add(direction)

    try {
      const page = await this.request(sessionId, direction, cursor, agentId)

      if (!page) return HistoryPageSkip.Stale
      window[direction] = page[direction]

      if (!page.events.length || (edge && page.events.every((event) => historyCursor(event) === edge))) window.exhausted.add(key)
      if (window.exhausted.size > EXHAUSTED_EDGE_LIMIT) window.exhausted.delete(window.exhausted.values().next().value!)

      return page.events
    } finally {
      window.busy.delete(direction)
    }
  }

  private async request(sessionId: string, direction: HistoryDirection, anchor?: string, agentId?: string) {
    const generation = this.generations.get(sessionId)

    if (!generation) return null

    const page = pageSchema.parse(
      await this.connection.request({
        operation: LocalOperation.History,
        sessionId,
        generation,
        direction,
        ...(anchor ? { anchor } : {}),
        ...(agentId ? { agentId } : {}),
      }),
    )

    // A subagent's items belong to its own view, never to the parent session's feed.
    if (!agentId) this.handlers.onHistory?.(sessionId, page.events)

    return page
  }

  /** The paging state of the session's (or subagent's) current generation; a new generation starts empty. */
  private window(sessionId: string, agentId?: string) {
    const generation = this.generations.get(sessionId)

    if (!generation) return undefined
    const key = windowKey(sessionId, agentId)
    const current = this.windows.get(key)

    if (current?.generation === generation) return current
    const created: HistoryWindowState = { generation, before: null, after: null, busy: new Set(), exhausted: new Set(), loaded: false }

    this.windows.set(key, created)

    return created
  }
}
