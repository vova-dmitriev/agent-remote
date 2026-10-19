import { QueryClient } from "@tanstack/react-query"
import { readingPositionResponseSchema, type ReadingPosition as StoredPosition } from "@protocol"
import {
  READING_POSITION_LIMITS,
  mergePosition,
  readPosition,
  subscribePositions,
  type ReadingPosition,
} from "@/shared/lib/reading-position"

type PositionOperations = Pick<import("@/shared/api").ApplicationOperations, "getReadingPosition" | "saveReadingPosition">

export class ReadingPositions {
  private cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  private scopes = new Map<string, string>()
  private pending = new Map<string, StoredPosition>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private unsubscribe: () => void

  constructor(private operations: PositionOperations) {
    this.unsubscribe = subscribePositions((scope, position) => {
      if (!this.scopes.has(scope) || !position.updatedAt) return
      this.pending.set(scope, { ...position, updatedAt: position.updatedAt })
      clearTimeout(this.timer)
      this.timer = setTimeout(this.flush, READING_POSITION_LIMITS.saveDelayMs)
    })

    globalThis.window?.addEventListener?.("pagehide", this.flush)
  }

  private async load(scope: string, sessionId: string, current: () => boolean) {
    this.scopes.set(scope, sessionId)
    const local = readPosition(scope)

    try {
      const response = await this.cache.fetchQuery({
        queryKey: ["reading-position", scope],
        staleTime: 0,
        queryFn: async () => readingPositionResponseSchema.parse(await this.operations.getReadingPosition(sessionId)),
      })

      if (!this.stopped && current()) {
        mergePosition(scope, response.position)
        const position = readPosition(scope)

        if (position?.updatedAt && position.updatedAt > (response.position?.updatedAt ?? 0)) this.enqueue(scope, position)
      }
    } catch {
      // The last local position remains usable while the server is unreachable.
      if (local?.updatedAt && current()) this.enqueue(scope, local)
    }
  }

  async query(scope: string, sessionId: string, current: () => boolean) {
    await this.load(scope, sessionId, current)
    const bookmark = readPosition(scope)

    return bookmark
      ? "?around=" +
          encodeURIComponent(bookmark.messageId) +
          (bookmark.cursor?.startsWith("position:") ? "&position=" + encodeURIComponent(bookmark.cursor) : "")
      : ""
  }

  private enqueue(scope: string, position: ReadingPosition) {
    if (!position.updatedAt) return
    this.pending.set(scope, { ...position, updatedAt: position.updatedAt })
    clearTimeout(this.timer)
    this.timer = setTimeout(this.flush, READING_POSITION_LIMITS.saveDelayMs)
  }

  flush = () => {
    clearTimeout(this.timer)
    if (this.stopped) return

    for (const [scope, position] of this.pending) {
      this.pending.delete(scope)
      const sessionId = this.scopes.get(scope)

      if (!sessionId) continue

      const mutation = this.cache.getMutationCache().build(this.cache, {
        mutationFn: async () => readingPositionResponseSchema.parse(await this.operations.saveReadingPosition(sessionId, position)),
      })

      void mutation.execute(undefined).catch(() => {
        if (!this.stopped && !this.pending.has(scope)) this.pending.set(scope, position)
      })
    }
  }

  close() {
    this.stopped = true
    this.unsubscribe()
    clearTimeout(this.timer)
    globalThis.window?.removeEventListener?.("pagehide", this.flush)
    this.pending.clear()
    this.scopes.clear()
    this.cache.clear()
  }
}
