import { SidebarKey, SidebarWidth } from "../config/values"

/** Rounds to whole pixels and keeps the width inside the allowed range. */
export function clampSidebarWidth(value: number): number {
  return Math.min(SidebarWidth.Max, Math.max(SidebarWidth.Min, Math.round(value)))
}

/** Reads a stored width; anything missing or malformed falls back to the default. */
export function parseSidebarWidth(stored: string | null | undefined): number {
  const value = Number(stored)

  return stored && Number.isFinite(value) ? clampSidebarWidth(value) : SidebarWidth.Default
}

/** Width after a keyboard press on the resize handle, or `undefined` for keys the handle ignores. */
export function keyedSidebarWidth(key: string, width: number): number | undefined {
  const next: Record<string, number> = {
    [SidebarKey.Left]: width - SidebarWidth.KeyStep,
    [SidebarKey.Right]: width + SidebarWidth.KeyStep,
    [SidebarKey.Home]: SidebarWidth.Min,
    [SidebarKey.End]: SidebarWidth.Max,
  }

  return key in next ? clampSidebarWidth(next[key]!) : undefined
}
