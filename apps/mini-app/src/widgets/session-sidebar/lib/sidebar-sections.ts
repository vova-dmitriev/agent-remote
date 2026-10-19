import type { Session } from "@protocol"
import type { ProviderFilterValue } from "@/entities/session"
import { filterSessions } from "./sidebar-search"
import { groupByRecency, type SidebarSection } from "./sidebar-groups"

interface SectionsInput {
  sessions: Session[]
  query: string
  provider: ProviderFilterValue
  now: number
}

/**
 * Filters and groups the list, recomputing only when the session array, query, provider or clock tick changes.
 * Message, history and outbox updates keep the snapshot's session array, so they reuse the previous sections.
 */
export function createSectionsMemo() {
  let last: { input: SectionsInput; sections: SidebarSection[] } | null = null

  return (input: SectionsInput): SidebarSection[] => {
    const previous = last?.input

    if (
      last &&
      previous?.sessions === input.sessions &&
      previous.query === input.query &&
      previous.provider === input.provider &&
      previous.now === input.now
    ) {
      return last.sections
    }

    const sections = groupByRecency(filterSessions(input.sessions, input.query, input.provider), input.now)

    last = { input, sections }

    return sections
  }
}
