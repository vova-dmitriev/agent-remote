import type { Session } from "@protocol"
import { SidebarGroup } from "../config/values"

export interface SidebarSection {
  group: SidebarGroup
  sessions: Session[]
}

const DAY_MS = 86_400_000

export function sessionTime(session: Session): number {
  return session.lastMessageAt ?? session.lastEventAt
}

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

/** Sorts sessions newest first and buckets them into Today / Yesterday / Earlier by local calendar day. */
export function groupByRecency(sessions: Session[], now: number): SidebarSection[] {
  const sorted = [...sessions].sort((a, b) => sessionTime(b) - sessionTime(a))
  const sections: SidebarSection[] = []

  for (const session of sorted) {
    const group = groupOf(sessionTime(session), now)
    const last = sections.at(-1)

    if (last?.group === group) last.sessions.push(session)
    else sections.push({ group, sessions: [session] })
  }

  return sections
}
