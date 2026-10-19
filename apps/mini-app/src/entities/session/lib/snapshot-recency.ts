import type { AppSnapshot } from "@protocol"

/**
 * Raises one session's `lastMessageAt` without disturbing list identity: when the time does not move (or the session is
 * unknown) the same snapshot is returned; otherwise only that session object and the array holding it are replaced.
 */
export function withLastMessageAt(snapshot: AppSnapshot | null, sessionId: string, occurredAt: number): AppSnapshot | null {
  const index = snapshot?.sessions.findIndex((session) => session.id === sessionId) ?? -1
  const session = index === -1 ? undefined : snapshot!.sessions[index]

  if (!snapshot || !session || (session.lastMessageAt ?? 0) >= occurredAt) return snapshot

  const sessions = [...snapshot.sessions]

  sessions[index] = { ...session, lastMessageAt: occurredAt }

  return { ...snapshot, sessions }
}
