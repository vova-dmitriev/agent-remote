import { useState } from "react"
import { ErrorCode, type ModelChoice, type Session } from "@protocol"
import { useStableCallback } from "@/shared/lib/hooks"
import { useRuntime } from "@/shared/lib/runtime"

const NO_CHOICES: ReadonlyMap<string, ModelChoice> = new Map()

/**
 * Switches sessions to another model. The snapshot shows a session's model, not its effort, so the last choice made
 * here is kept per session to show both.
 */
export function useSwitchModel() {
  const runtime = useRuntime()
  const [choices, setChoices] = useState(NO_CHOICES)

  const [busy, setBusy] = useState(false)
  /** Why the device refused the last switch, as an error code; empty while the last switch went through. */
  const [error, setError] = useState("")

  // The device shows the new model in its next snapshot, so no query needs refreshing; the effort is only known here.
  const switchModel = useStableCallback(async (session: Session, choice: ModelChoice) => {
    const lease = runtime.current()

    setError(lease ? "" : ErrorCode.NO_AUTHENTICATED_CLIENT)
    if (!lease) return
    setBusy(true)

    try {
      await lease.client.switchSessionModel(session.id, session.generation, choice)
      setChoices((current) => new Map(current).set(session.id, choice))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : ErrorCode.REQUEST_FAILED)
    } finally {
      setBusy(false)
    }
  })

  const chosen = useStableCallback((sessionId: string) => choices.get(sessionId))

  return { switchModel, chosen, busy, error }
}

export type SwitchModelController = ReturnType<typeof useSwitchModel>
