import type { Session } from "@protocol"
import { sessionRecency, sortByRecency } from "@/entities/session"
import { SidebarGroup } from "../config/values"

export interface SidebarSection {
  group: SidebarGroup
  sessions: Session[]
}

const DAY_MS = 86_400_000

function startOfDay(time: number): number {
  const date = new Date(time)

  date.setHours(0, 0, 0, 0)

  return date.getTime()
}

function groupOf(time: number, now: number): SidebarGroup {
  const today = startOfDay(now)

  if (time >= today) return SidebarGroup.Today
  if (time >= today - DAY_MS) return SidebarGroup.Yesterday

  return SidebarGroup.Earlier
}

/**
 * Sorts sessions newest first: pinned ones lead in their own section, the rest are bucketed into Today / Yesterday /
 * Earlier by local calendar day.
 */
export function groupByRecency(sessions: Session[], now: number): SidebarSection[] {
  const sorted = sortByRecency(sessions)
  const pinned = sorted.filter((session) => session.pinned)
  const sections: SidebarSection[] = pinned.length ? [{ group: SidebarGroup.Pinned, sessions: pinned }] : []

  for (const session of sorted) {
    if (session.pinned) continue

    const group = groupOf(sessionRecency(session), now)
    const last = sections.at(-1)

    if (last?.group === group) last.sessions.push(session)
    else sections.push({ group, sessions: [session] })
  }

  return sections
}
