export interface UnreadBadgeProps {
  /** The agent's replies since the owner last read the session; nothing shows for none. */
  count: number | undefined
  className?: string
}
