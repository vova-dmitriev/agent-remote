import { useState } from "react"
import { COLLAPSED_PROJECTS_STORAGE_KEY } from "../config/values"

function readCollapsed(): ReadonlySet<string> {
  try {
    const stored: unknown = JSON.parse(globalThis.localStorage?.getItem(COLLAPSED_PROJECTS_STORAGE_KEY) ?? "[]")

    return new Set(Array.isArray(stored) ? stored.filter((key) => typeof key === "string") : [])
  } catch {
    return new Set()
  }
}

function writeCollapsed(keys: ReadonlySet<string>) {
  try {
    globalThis.localStorage?.setItem(COLLAPSED_PROJECTS_STORAGE_KEY, JSON.stringify([...keys]))
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the choice then lasts for this page only.
  }
}

/** Which project groups are collapsed, remembered per viewer when local storage is available. */
export function useCollapsedProjects() {
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const toggle = (key: string) => {
    const next = new Set(collapsed)

    if (!next.delete(key)) next.add(key)

    setCollapsed(next)
    writeCollapsed(next)
  }

  return { collapsed, toggle }
}
