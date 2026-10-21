import { BoundProfileClient } from "@transport/profile-client"
import { BoundContinuityClient } from "@transport/continuity/continuity-client"
import { BoundProfileRoutingClient } from "@transport/profile-routing-client"
import {
  HttpRequestMethod,
  accountPreferencesSchema,
  readingPositionResponseSchema,
  sessionFileSchema,
  analyticsReportSchema,
  type AnalyticsPeriod,
  type PreferencePatch,
  type ReadingPosition,
} from "@protocol"
import type { ApplicationOperations, Device } from "@/shared/api"
import { RelayCommandOperations } from "./relay-command-operations"

export abstract class RelayOperations extends RelayCommandOperations implements ApplicationOperations {
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

  async readSessionFile(sessionId: string, _generation: string, path: string) {
    const query = new URLSearchParams({ path })

    return sessionFileSchema.parse(await this.request("/sessions/" + encodeURIComponent(sessionId) + "/file?" + query))
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
