import { accountPreferencesSchema, type PreferencePatch } from "@protocol"
import type { ApplicationClient } from "@/shared/api"

export async function loadPreferences(client: ApplicationClient) {
  return accountPreferencesSchema.parse(await client.getPreferences())
}

export async function savePreferences(client: ApplicationClient, patch: PreferencePatch) {
  return accountPreferencesSchema.parse(await client.savePreferences(patch))
}
