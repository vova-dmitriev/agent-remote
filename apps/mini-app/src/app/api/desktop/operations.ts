import { z } from "zod"
import {
  ErrorCode,
  LocalOperation,
  accountPreferencesSchema,
  readingPositionSchema,
  sessionFileSchema,
  analyticsReportSchema,
  rulesReplySchema,
  type RulesRequest,
  type AnalyticsQuery,
  type PreferencePatch,
  type ReadingPosition,
  type SessionRemoval,
  type ModelChoice,
  type ProjectSession,
  projectSessionReplySchema,
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

  removeSession(sessionId: string, generation: string, mode: SessionRemoval) {
    return this.connection.request({ operation: LocalOperation.Remove, sessionId, generation, mode })
  }

  switchSessionModel(sessionId: string, generation: string, choice: ModelChoice) {
    return this.connection.request({ operation: LocalOperation.Model, sessionId, generation, choice })
  }

  async createProjectSession(_deviceId: string, session: ProjectSession) {
    return projectSessionReplySchema.parse(await this.connection.request({ operation: LocalOperation.Create, session }))
  }

  async readSessionFile(sessionId: string, generation: string, path: string) {
    return sessionFileSchema.parse(await this.connection.request({ operation: LocalOperation.File, sessionId, generation, path }))
  }

  /** The companion's own device: the report is counted on this Mac. */
  async rules(_deviceId: string, request: RulesRequest) {
    return rulesReplySchema.parse(await this.connection.request({ operation: LocalOperation.Rules, request }))
  }

  async usageReport(_deviceId: string, query: AnalyticsQuery) {
    return analyticsReportSchema.parse(await this.connection.request({ operation: LocalOperation.Analytics, ...query }))
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
