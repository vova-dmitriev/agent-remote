import { useState } from "react"
import { SIDEBAR_COLLAPSED_STORAGE_KEY } from "../config/values"

function readCollapsed(): boolean {
  try {
    return globalThis.localStorage?.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === String(true)
  } catch {
    return false
  }
}

function writeCollapsed(value: boolean) {
  try {
    globalThis.localStorage?.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(value))
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the choice then lasts for this page only.
  }
}

/** Sidebar collapse state, remembered per viewer when local storage is available. */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const update = (value: boolean) => {
    setCollapsed(value)
    writeCollapsed(value)
  }

  return { collapsed, setCollapsed: update, toggle: () => update(!collapsed) }
}
