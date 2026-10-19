import { Asterisk, Hexagon } from "lucide-react"
import { AgentName, SessionStatusDot, agentName } from "@/entities/session"
import type { ProviderIconProps } from "./list.types"

/** Provider glyph (Lucide stand-ins, not brand marks) wearing the session status as a corner badge. */
export function ProviderIcon({ session }: ProviderIconProps) {
  return (
    <span className="relative grid size-7 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground">
      {agentName(session) === AgentName.Claude ? <Asterisk aria-hidden="true" size={16} /> : <Hexagon aria-hidden="true" size={14} />}
      <SessionStatusDot session={session} className="absolute -right-0.5 -bottom-0.5 size-2.5 ring-2 ring-card" />
    </span>
  )
}
