import { accountPreferencesSchema, type PreferencePatch } from "@protocol"
import type { AppTransport } from "./transport"

export async function loadPreferences(client: AppTransport) {
  return accountPreferencesSchema.parse(await client.request("/preferences"))
}

export async function savePreferences(client: AppTransport, patch: PreferencePatch) {
  return accountPreferencesSchema.parse(await client.request("/preferences", { method: "PATCH", body: JSON.stringify(patch) }))
}
