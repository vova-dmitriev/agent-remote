import { BoundProfileClient } from "@transport/profile-client"
import { BoundContinuityClient } from "@transport/continuity/continuity-client"
import { BoundProfileRoutingClient } from "@transport/profile-routing-client"
import {
  HttpRequestMethod,
  accountPreferencesSchema,
  readingPositionResponseSchema,
  sessionFileSchema,
  analyticsReportSchema,
  rulesReplySchema,
  sessionSkillsSchema,
  sessionSchema,
  historySchema,
  HISTORY_OUTLINE_MESSAGES,
  HISTORY_SEARCH_MESSAGES,
  CodedError,
  ErrorCode,
  type RulesRequest,
  type AnalyticsPeriod,
  type PreferencePatch,
  type ReadingPosition,
  type SessionRemoval,
  type ModelChoice,
  type ProviderFilterValue,
  SessionListLimits,
  type ProjectSession,
  projectSessionReplySchema,
  type EventEnvelope,
} from "@protocol"
import { z } from "zod"
import type { ApplicationOperations, Device } from "@/shared/api"
import { aroundQuery } from "@/entities/session"
import { RelayCommandOperations } from "./relay-command-operations"

export abstract class RelayOperations extends RelayCommandOperations implements ApplicationOperations {
  async listSessions(deviceId: string, provider: ProviderFilterValue, cursor?: string) {
    const query = new URLSearchParams({ provider })

    if (cursor) query.set("cursor", cursor)

    return z
      .strictObject({
        sessions: z.array(sessionSchema).max(SessionListLimits.PageSize),
        nextCursor: z.string().max(SessionListLimits.CursorLength).nullable(),
      })
      .parse(await this.request(`/devices/${encodeURIComponent(deviceId)}/sessions?${query}`))
  }

  async sessionSkills(sessionId: string, generation: string) {
    const query = new URLSearchParams({ generation })
    const result = sessionSkillsSchema.parse(await this.request(`/sessions/${encodeURIComponent(sessionId)}/skills?${query}`))

    if (result.sessionId !== sessionId || result.generation !== generation) throw new CodedError(ErrorCode.INVALID_FRAME)

    return result
  }

  /** Latest reloads the newest page, or the window `around` names, instead of the saved reading position. */
  abstract history(sessionId: string, latest?: boolean, around?: string): Promise<EventEnvelope[] | null>

  historyAround(sessionId: string, messageId: string, cursor?: string) {
    return this.history(sessionId, true, aroundQuery(messageId, cursor))
  }

  async historyOutline(sessionId: string) {
    return z
      .array(historySchema)
      .max(HISTORY_OUTLINE_MESSAGES)
      .parse(await this.request(`/sessions/${encodeURIComponent(sessionId)}/outline`))
  }

  async historySearch(sessionId: string, query: string) {
    return z
      .array(historySchema)
      .max(HISTORY_SEARCH_MESSAGES)
      .parse(await this.request(`/sessions/${encodeURIComponent(sessionId)}/search?${new URLSearchParams({ q: query })}`))
  }

  protected routingAccess(deviceId: string, current: () => boolean) {
    return new BoundProfileRoutingClient(
      deviceId,
      (method, path, body) => this.request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
      current,
    )
  }

  protected continuityAccess(deviceId: string, current: () => boolean) {
    return new BoundContinuityClient(
      deviceId,
      (method, path, body) => this.request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
      current,
    )
  }

  protected profileAccess(deviceId: string, current: () => boolean) {
    return new BoundProfileClient(
      deviceId,
      (request) =>
        this.request(`/devices/${encodeURIComponent(deviceId)}/profiles`, {
          method: HttpRequestMethod.Post,
          body: JSON.stringify(request),
        }),
      current,
    )
  }

  async getPreferences() {
    return accountPreferencesSchema.parse(await this.request("/preferences"))
  }

  async savePreferences(patch: PreferencePatch) {
    return accountPreferencesSchema.parse(await this.request("/preferences", { method: "PATCH", body: JSON.stringify(patch) }))
  }

  renameSession(sessionId: string, title: string, generation: string) {
    return this.request("/sessions/" + encodeURIComponent(sessionId), { method: "PATCH", body: JSON.stringify({ title, generation }) })
  }

  pinSession(sessionId: string, generation: string, pinned: boolean) {
    return this.request("/sessions/" + encodeURIComponent(sessionId) + "/pin", {
      method: "PUT",
      body: JSON.stringify({ pinned, generation }),
    })
  }

  removeSession(sessionId: string, generation: string, mode: SessionRemoval) {
    return this.request("/sessions/" + encodeURIComponent(sessionId) + "/remove", {
      method: "POST",
      body: JSON.stringify({ mode, generation }),
    })
  }

  switchSessionModel(sessionId: string, generation: string, choice: ModelChoice) {
    return this.request("/sessions/" + encodeURIComponent(sessionId) + "/model", {
      method: "PUT",
      body: JSON.stringify({ choice, generation }),
    })
  }

  async createProjectSession(deviceId: string, session: ProjectSession) {
    return projectSessionReplySchema.parse(
      await this.request("/devices/" + encodeURIComponent(deviceId) + "/sessions", { method: "POST", body: JSON.stringify(session) }),
    )
  }

  async readSessionFile(sessionId: string, _generation: string, path: string) {
    const query = new URLSearchParams({ path })

    return sessionFileSchema.parse(await this.request("/sessions/" + encodeURIComponent(sessionId) + "/file?" + query))
  }

  async rules(deviceId: string, request: RulesRequest) {
    return rulesReplySchema.parse(
      await this.request("/devices/" + encodeURIComponent(deviceId) + "/rules", { method: "POST", body: JSON.stringify(request) }),
    )
  }

  async usageReport(deviceId: string, period: AnalyticsPeriod) {
    const query = new URLSearchParams({ period })

    return analyticsReportSchema.parse(await this.request("/devices/" + encodeURIComponent(deviceId) + "/analytics?" + query))
  }

  devices() {
    return this.request<Device[]>("/devices")
  }

  claimDevice(code: string) {
    return this.request("/pair/claim", { method: "POST", body: JSON.stringify({ code }) })
  }

  revokeDevice(deviceId: string) {
    return this.request("/devices/" + encodeURIComponent(deviceId), { method: "DELETE" })
  }

  async getReadingPosition(sessionId: string) {
    return readingPositionResponseSchema.parse(await this.request("/sessions/" + encodeURIComponent(sessionId) + "/reading-position"))
  }

  async saveReadingPosition(sessionId: string, position: ReadingPosition) {
    return readingPositionResponseSchema.parse(
      await this.request("/sessions/" + encodeURIComponent(sessionId) + "/reading-position", {
        method: "PUT",
        body: JSON.stringify(position),
        keepalive: true,
      }),
    )
  }
}
