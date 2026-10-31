import type { Session } from "@protocol"
import { sessionFolder } from "../labels"

/** The storage key and identity of the group of pinned sessions; a real project key is always an absolute path. */
export const PINNED_GROUP = "pinned"
/** The same for sessions that report no working directory. */
const NO_PROJECT_GROUP = "none"

export interface SessionGroup {
  key: string
  /** The project's folder name; null for the pinned group and for sessions without a project. */
  name: string | null
  sessions: Session[]
}

/**
 * Pinned sessions lead in their own group, the rest are grouped by working directory. Projects keep the order of the
 * given list, so a recency-sorted list puts the most recently active project first. Same-named folders stay apart.
 */
export function groupByProject(sessions: Session[]): SessionGroup[] {
  const groups = new Map<string, SessionGroup>()

  const add = (key: string, name: string | null, session: Session) => {
    const group = groups.get(key)

    if (group) group.sessions.push(session)
    else groups.set(key, { key, name, sessions: [session] })
  }

  for (const session of sessions) if (session.pinned) add(PINNED_GROUP, null, session)

  for (const session of sessions) {
    if (!session.pinned) add(session.cwd ?? NO_PROJECT_GROUP, sessionFolder(session), session)
  }

  return [...groups.values()]
}
