import { z } from "zod"
import {
  FrameType,
  HistoryDirection,
  LocalOperation,
  eventSchema,
  type EventEnvelope,
  type HistoryPageDirection,
  type ServerFrame,
} from "@protocol"
import type { TransportHandlers } from "../types.js"
import type { DesktopBridgeConnection } from "./desktop-connection.js"

const pageSchema = z.strictObject({ events: z.array(eventSchema), before: z.string().nullable(), after: z.string().nullable() })

export class DesktopHistory {
  private generations = new Map<string, string>()

  constructor(
    private readonly connection: DesktopBridgeConnection,
    private readonly handlers: TransportHandlers,
  ) {}

  observe(frame: ServerFrame): void {
    if (frame.type !== FrameType.Snapshot) return

    for (const session of frame.snapshot.sessions) this.generations.set(session.id, session.generation)
  }

  async load(sessionId: string): Promise<EventEnvelope[] | null> {
    return this.request(sessionId, HistoryDirection.Latest)
  }

  async page(sessionId: string, direction: HistoryPageDirection, edge?: string): Promise<EventEnvelope[] | null> {
    return this.request(sessionId, direction, edge)
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

    return page.events
  }
}
