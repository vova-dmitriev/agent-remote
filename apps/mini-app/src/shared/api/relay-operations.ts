import { BoundProfileClient } from "@transport/profile-client"
import {
  HttpRequestMethod,
  accountPreferencesSchema,
  readingPositionResponseSchema,
  type PreferencePatch,
  type ReadingPosition,
} from "@protocol"
import type { ApplicationOperations } from "./application-client"

export abstract class RelayOperations implements ApplicationOperations {
  protected abstract request<T>(path: string, options?: RequestInit): Promise<T>

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
