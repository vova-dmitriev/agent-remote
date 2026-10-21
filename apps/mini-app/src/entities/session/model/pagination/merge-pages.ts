import type { Session } from "@protocol"

/**
 * The conversation a session shows: Claude's session id or Codex's thread id, which outlive the device's session
 * id (a restart or another terminal binds the same conversation under a new one).
 */
const conversationOf = (session: Session) =>
  session.claudeSessionId ?? ("threadId" in session.target ? session.target.threadId : session.id)

/**
 * Combines bounded pages with the snapshot, one row per conversation: the snapshot's live row wins over a page's
 * older record of the same conversation. Keeps the stable recency order.
 */
export function mergeSessionPages(snapshot: readonly Session[], pages: readonly Session[]) {
  const sessions = new Map(pages.map((session) => [conversationOf(session), session]))

  for (const session of snapshot) sessions.set(conversationOf(session), session)

  return [...sessions.values()].sort(
    (left, right) =>
      (right.lastMessageAt ?? right.createdAt ?? 0) - (left.lastMessageAt ?? left.createdAt ?? 0) || left.id.localeCompare(right.id),
  )
}
