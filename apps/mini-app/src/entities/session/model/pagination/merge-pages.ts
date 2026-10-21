import type { Session } from "@protocol"

/** Combines bounded pages without duplicating snapshot rows and keeps the stable recency order. */
export function mergeSessionPages(snapshot: readonly Session[], pages: readonly Session[]) {
  const sessions = new Map(pages.map((session) => [session.id, session]))

  for (const session of snapshot) sessions.set(session.id, session)

  return [...sessions.values()].sort(
    (left, right) =>
      (right.lastMessageAt ?? right.createdAt ?? 0) - (left.lastMessageAt ?? left.createdAt ?? 0) || left.id.localeCompare(right.id),
  )
}
