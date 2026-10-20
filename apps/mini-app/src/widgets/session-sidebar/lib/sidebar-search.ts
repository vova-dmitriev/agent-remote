import type { Session } from "@protocol"
import { agentName, filterByProvider, sessionFolder, sessionTitle, type ProviderFilterValue } from "@/entities/session"

export interface MatchPart {
  text: string
  match: boolean
}

/** Untitled rows show the whole source id; the row truncates it with an ellipsis and keeps it in `title`. */
const ROW_ID_FALLBACK_LENGTH = 64

export function rowTitle(session: Session): string | null {
  return sessionTitle(session, ROW_ID_FALLBACK_LENGTH)
}

/** Title, project, model and provider name are searchable; the provider makes "codex" / "claude" useful queries. */
function containsQuery(session: Session, needle: string): boolean {
  const haystack = [rowTitle(session), sessionFolder(session), session.model, agentName(session)].filter(Boolean).join("\n")

  return haystack.toLowerCase().includes(needle)
}

export function filterSessions(sessions: Session[], query: string, provider: ProviderFilterValue): Session[] {
  const needle = query.trim().toLowerCase()

  const byProvider = filterByProvider(sessions, provider)

  return needle ? byProvider.filter((session) => containsQuery(session, needle)) : byProvider
}

/** Splits text into plain and matching parts, case-insensitively, for every occurrence of the query. */
export function matchParts(text: string, query: string): MatchPart[] {
  const needle = query.trim().toLowerCase()

  if (!needle) return [{ text, match: false }]

  const parts: MatchPart[] = []
  const lower = text.toLowerCase()
  let cursor = 0
  let index = lower.indexOf(needle)

  while (index !== -1) {
    if (index > cursor) parts.push({ text: text.slice(cursor, index), match: false })

    parts.push({ text: text.slice(index, index + needle.length), match: true })
    cursor = index + needle.length
    index = lower.indexOf(needle, cursor)
  }

  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false })

  return parts
}
