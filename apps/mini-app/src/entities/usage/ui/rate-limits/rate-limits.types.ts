import type { RateLimit } from "@protocol"

export interface RateLimitsProps {
  /** The windows of the session's agent, shortest first. */
  limits: readonly RateLimit[]
  /** The agent's name for the details title: Claude, Codex. */
  agent: string
  /** A fixed clock for stories; the live clock otherwise. */
  now?: number
}

export interface LimitDetailsProps {
  limits: readonly RateLimit[]
  agent: string
  now: number
}
