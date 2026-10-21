import { UNKNOWN_USAGE_KEY, type AnalyticsReport, type Session } from "@protocol"
import { sessionTitle } from "@/entities/session"

type Row = AnalyticsReport["byModel"][number]

/** The id a session's usage is counted under: the Codex thread, or Claude's session id. */
const usageKey = (session: Session) => ("threadId" in session.target ? session.target.threadId : session.claudeSessionId)

/** A session row named as the app names the session when it is open, else by its folder. */
export function sessionRows(rows: readonly Row[], sessions: readonly Session[]): Row[] {
  const titles = new Map(
    sessions.flatMap((session) => {
      const key = usageKey(session)
      const title = sessionTitle(session, 16)

      return key && title ? [[key, title] as const] : []
    }),
  )

  return rows.map((row) => ({ ...row, label: titles.get(row.key) ?? row.label }))
}

export const unknownRow = (row: Row) => row.key === UNKNOWN_USAGE_KEY
