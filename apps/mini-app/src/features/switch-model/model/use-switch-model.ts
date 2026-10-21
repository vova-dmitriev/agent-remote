import { useState } from "react"
import type { ModelChoice, Session } from "@protocol"
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
  const [failed, setFailed] = useState(false)

  // The device shows the new model in its next snapshot, so no query needs refreshing; the effort is only known here.
  const switchModel = useStableCallback(async (session: Session, choice: ModelChoice) => {
    const lease = runtime.current()

    setFailed(!lease)
    if (!lease) return
    setBusy(true)

    try {
      await lease.client.switchSessionModel(session.id, session.generation, choice)
      setChoices((current) => new Map(current).set(session.id, choice))
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  })

  const chosen = useStableCallback((sessionId: string) => choices.get(sessionId))

  return { switchModel, chosen, busy, failed }
}

export type SwitchModelController = ReturnType<typeof useSwitchModel>
