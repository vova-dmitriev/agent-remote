import type { PreferencePatch } from "@protocol"

const listeners = new Set<(patch: PreferencePatch) => void>()

export function selectPreference(patch: PreferencePatch) {
  for (const listener of listeners) listener(patch)
}

export function subscribePreferences(listener: (patch: PreferencePatch) => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}
