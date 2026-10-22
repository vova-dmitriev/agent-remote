import { SessionTab } from "@/entities/session"
import { SessionComposer } from "@/features/send-command"
import { TerminalInput } from "./terminal/terminal-input"
import type { SessionInputProps } from "./session-page.types"

/** Under the Terminal tab, input goes to the session's terminal where its source can type there; else the composer. */
export function SessionInput({ tab, session, controller, connection, deviceStatus }: SessionInputProps) {
  if (tab === SessionTab.Terminal && session.capabilities.terminalInput) return <TerminalInput session={session} />

  return <SessionComposer controller={controller} session={session} connection={connection} deviceStatus={deviceStatus} />
}
