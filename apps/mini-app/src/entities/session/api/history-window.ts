import { HistoryPageDirection, HistoryDirection, type EventEnvelope } from "@protocol"
import type { HistoryCursors } from "./history"

export class HistoryWindow {
  private cursors: HistoryCursors = { before: "", after: "" }
  private busy = false
  private exhausted = new Set<string>()

  reset() {
    this.exhausted.clear()
    this.cursors = { before: "", after: "" }
  }

  observe = (cursors: HistoryCursors) => {
    this.cursors = cursors
  }

  async page(
    direction: HistoryPageDirection,
    request: (query: string, observe: (response: Response) => void) => Promise<EventEnvelope[]>,
    current: () => boolean,
    edge?: string,
    agentId?: string,
  ) {
    const cursor = edge?.startsWith("position:")
      ? "source:" + edge.slice(9)
      : edge?.startsWith("cache:")
        ? edge.slice(6)
        : this.cursors[direction]

    const key = direction + ":" + cursor

    if (!cursor || this.busy || !current() || this.exhausted.has(key)) return null
    this.busy = true

    try {
      const subagent = agentId ? "&agentId=" + encodeURIComponent(agentId) : ""

      const events = await request("?" + direction + "=" + encodeURIComponent(cursor) + subagent, (response) => {
        if (current())
          this.cursors[direction] = response.headers.get(direction === HistoryDirection.Before ? "x-next-cursor" : "x-after-cursor") ?? ""
      })

      if (!events.length || (edge && events.every((event) => (event.payload as { historyCursor?: string }).historyCursor === edge)))
        this.exhausted.add(key)
      if (this.exhausted.size > 4) this.exhausted.delete(this.exhausted.values().next().value!)

      return current() ? events : null
    } finally {
      this.busy = false
    }
  }
}
