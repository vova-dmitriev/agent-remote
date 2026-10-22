import { useState } from "react"
import { CommandActionType, CommandStatus, ErrorCode, type Session, type TerminalKey } from "@protocol"
import { useStableCallback } from "@/shared/lib/hooks"
import { useRuntime } from "@/shared/lib/runtime"

/**
 * Types into the session's terminal and presses keys there. Every press is its own command, so pressing a key twice
 * presses it twice; the terminal screen shows the effect with its next capture.
 */
export function useTerminalInput(session: Session) {
  const runtime = useRuntime()
  const [text, setText] = useState("")
  /** Why the last input did not reach the terminal, as an error code; empty while it did. */
  const [error, setError] = useState("")

  const send = useStableCallback(async (input: { text?: string; key?: TerminalKey }) => {
    const lease = runtime.current()

    setError(lease ? "" : ErrorCode.NO_AUTHENTICATED_CLIENT)
    if (!lease) return false

    try {
      const result = await lease.client.send({
        commandId: crypto.randomUUID(),
        target: session.target,
        sessionId: session.id,
        generation: session.generation,
        action: { type: CommandActionType.TerminalInput, ...input },
      })

      if (result.status === CommandStatus.Rejected) setError(result.code ?? ErrorCode.COMMAND_DELIVERY_FAILED)

      return result.status !== CommandStatus.Rejected
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : ErrorCode.COMMAND_DELIVERY_FAILED)

      return false
    }
  })

  /** The typed line, then Enter, as at the terminal; the field clears once it went. */
  const submit = useStableCallback(async (key: TerminalKey) => {
    const line = text

    if (await send(line ? { text: line, key } : { key })) setText((current) => (current === line ? "" : current))
  })

  return { text, setText, press: (key: TerminalKey) => void send({ key }), submit, error }
}
