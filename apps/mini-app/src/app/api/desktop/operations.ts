import { z } from "zod"
import {
  ErrorCode,
  LocalOperation,
  accountPreferencesSchema,
  readingPositionSchema,
  sessionFileSchema,
  analyticsReportSchema,
  type AnalyticsPeriod,
  type PreferencePatch,
  type ReadingPosition,
} from "@protocol"
import type { DesktopBridgeConnection } from "./desktop-connection.js"

const bookmarkSchema = z.strictObject({ revision: z.number().int().nonnegative(), position: readingPositionSchema.nullable() })

export class DesktopOperations {
  private bookmarks = new Map<string, z.infer<typeof bookmarkSchema>>()
  private saves = new Set<string>()

  constructor(private readonly connection: DesktopBridgeConnection) {}

  async getPreferences() {
    return accountPreferencesSchema.parse(await this.connection.request({ operation: LocalOperation.PreferencesGet }))
  }

  async savePreferences(patch: PreferencePatch) {
    return accountPreferencesSchema.parse(await this.connection.request({ operation: LocalOperation.PreferencesSave, patch }))
  }

  renameSession(sessionId: string, title: string, generation: string) {
    return this.connection.request({ operation: LocalOperation.Rename, sessionId, title, generation })
  }

  pinSession(sessionId: string, generation: string, pinned: boolean) {
    return this.connection.request({ operation: LocalOperation.Pin, sessionId, generation, pinned })
  }

  async readSessionFile(sessionId: string, generation: string, path: string) {
    return sessionFileSchema.parse(await this.connection.request({ operation: LocalOperation.File, sessionId, generation, path }))
  }

  /** The companion's own device: the report is counted on this Mac. */
  async usageReport(_deviceId: string, period: AnalyticsPeriod) {
    return analyticsReportSchema.parse(await this.connection.request({ operation: LocalOperation.Analytics, period }))
  }

  async getReadingPosition(sessionId: string) {
    const response = bookmarkSchema.parse(await this.connection.request({ operation: LocalOperation.ReadingGet, sessionId }))

    this.bookmarks.set(sessionId, response)

    return { position: response.position }
  }

  async saveReadingPosition(sessionId: string, position: ReadingPosition) {
    if (this.saves.has(sessionId)) throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT)

    this.saves.add(sessionId)

    try {
      if (!this.bookmarks.has(sessionId)) await this.getReadingPosition(sessionId)
      const bookmark = this.bookmarks.get(sessionId)!

      if (bookmark.position && position.updatedAt <= bookmark.position.updatedAt) {
        return { position: bookmark.position }
      }

      try {
        const response = bookmarkSchema.parse(
          await this.connection.request({
            operation: LocalOperation.ReadingSave,
            sessionId,
            position,
            revision: bookmark.revision,
          }),
        )

        this.bookmarks.set(sessionId, response)

        return { position: response.position }
      } catch (error) {
        if (error instanceof Error && error.message === ErrorCode.LOCAL_REVISION_CONFLICT) {
          return this.getReadingPosition(sessionId)
        }

        throw error
      }
    } finally {
      this.saves.delete(sessionId)
    }
  }
}
