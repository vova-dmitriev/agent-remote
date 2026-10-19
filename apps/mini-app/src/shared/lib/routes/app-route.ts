/** Desktop shell hash routes: `#/`, `#/sessions/:sessionId`, `#/sessions/:sessionId/agents/:agentId`. */
export const AppRoute = {
  Root: "#/",
  Sessions: "sessions",
  Agents: "agents",
} as const

const SEPARATOR = "/"

export interface ParsedRoute {
  sessionId?: string
  agentId?: string
}

function segment(value: string) {
  return encodeURIComponent(value)
}

export function sessionRoute(sessionId: string) {
  return AppRoute.Root + AppRoute.Sessions + SEPARATOR + segment(sessionId)
}

export function subagentRoute(sessionId: string, agentId: string) {
  return sessionRoute(sessionId) + SEPARATOR + AppRoute.Agents + SEPARATOR + segment(agentId)
}

function decode(value: string | undefined): string | undefined {
  if (!value) return undefined

  try {
    return decodeURIComponent(value) || undefined
  } catch {
    return undefined
  }
}

/** `{}` for `#/`, the ids for a session or subagent route, null for anything that is not an app route. */
export function parseRoute(hash: string): ParsedRoute | null {
  if (!hash.startsWith(AppRoute.Root)) return null

  const parts = hash.slice(AppRoute.Root.length).split(SEPARATOR)

  if (parts.length === 1 && parts[0] === "") return {}
  if (parts[0] !== AppRoute.Sessions || (parts.length !== 2 && parts.length !== 4)) return null

  const sessionId = decode(parts[1])

  if (!sessionId) return null
  if (parts.length === 2) return { sessionId }

  const agentId = decode(parts[3])

  return parts[2] === AppRoute.Agents && agentId ? { sessionId, agentId } : null
}
