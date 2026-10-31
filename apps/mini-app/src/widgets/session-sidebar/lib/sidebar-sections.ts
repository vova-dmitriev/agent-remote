import type { Session } from "@protocol"
import { groupByProject, sortByRecency, type ProviderFilterValue, type SessionGroup } from "@/entities/session"
import { filterSessions } from "./sidebar-search"

interface SectionsInput {
  sessions: Session[]
  query: string
  provider: ProviderFilterValue
}

/**
 * Filters and groups the list, recomputing only when the session array, query or provider changes.
 * Message, history and outbox updates keep the snapshot's session array, so they reuse the previous sections.
 */
export function createSectionsMemo() {
  let last: { input: SectionsInput; sections: SessionGroup[] } | null = null

  return (input: SectionsInput): SessionGroup[] => {
    const previous = last?.input

    if (last && previous?.sessions === input.sessions && previous.query === input.query && previous.provider === input.provider) {
      return last.sections
    }

    const sections = groupByProject(sortByRecency(filterSessions(input.sessions, input.query, input.provider)))

    last = { input, sections }

    return sections
  }
}
