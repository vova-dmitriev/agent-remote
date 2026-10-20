import { useState } from "react"
import { SIDEBAR_WIDTH_STORAGE_KEY, SidebarWidth } from "../config/values"
import { clampSidebarWidth, parseSidebarWidth } from "../lib/sidebar-width"

function readWidth(): number {
  try {
    return parseSidebarWidth(globalThis.localStorage?.getItem(SIDEBAR_WIDTH_STORAGE_KEY))
  } catch {
    return SidebarWidth.Default
  }
}

function writeWidth(value: number) {
  try {
    globalThis.localStorage?.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(value))
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the width then lasts for this page only.
  }
}

/**
 * Sidebar width, remembered per viewer when local storage is available. `resize` follows the pointer and saves only
 * when `done` is set, so a drag writes storage once.
 */
export function useSidebarWidth() {
  const [width, setWidth] = useState(readWidth)

  const resize = (value: number, done: boolean) => {
    const next = clampSidebarWidth(value)

    setWidth(next)
    if (done) writeWidth(next)
  }

  return { width, resize, reset: () => resize(SidebarWidth.Default, true) }
}
