import type { ThemePreference } from "@protocol"

export type { ThemePreference } from "@protocol"

const key = "claude-remote.theme.v1"

export function persistTheme(value: ThemePreference) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* The current selection still works when WebView storage is unavailable. */
  }
}
