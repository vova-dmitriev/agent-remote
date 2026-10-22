import { UNKNOWN_USAGE_KEY, type AnalyticsReport, type Session } from "@protocol"
import { sessionTitle } from "@/entities/session"

type Row = AnalyticsReport["byModel"][number]

/** The id a session's usage is counted under: the Codex thread, or Claude's session id. */
export const usageKey = (session: Session) => ("threadId" in session.target ? session.target.threadId : session.claudeSessionId)

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

/** A local day ("2026-10-22") as the app's language writes it: "22 Oct". */
export function dayLabel(day: string, language: string) {
  const [year, month, date] = day.split("-").map(Number)

  return new Date(year!, month! - 1, date).toLocaleDateString(language, { day: "numeric", month: "short" })
}

/** A picked session's name: as its usage row names it, else by the start of its id. */
const sessionName = (key: string, rows: readonly Row[], sessions: readonly Session[]) =>
  sessionRows(rows, sessions).find((row) => row.key === key)?.label ?? key.slice(0, 8)

/** The picked session's name: the title of the session the page was opened from, else as `sessionName` finds it. */
export function pickedSessionName(picked: string | undefined, from: Session | null, rows: readonly Row[], sessions: readonly Session[]) {
  if (picked === undefined) return undefined

  return (from && usageKey(from) === picked ? sessionTitle(from, 16) : undefined) ?? sessionName(picked, rows, sessions)
}
