import { useState } from "react"
import { ErrorCode } from "@protocol"

/**
 * A session starting in a project through the device, which answers once the session runs (a few seconds): while it
 * starts the form takes no second press, and a refusal is kept as an error code.
 */
export function useProjectStart() {
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState("")

  async function start(run: () => Promise<unknown>) {
    if (starting) return
    setError("")
    setStarting(true)

    try {
      await run()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : ErrorCode.REQUEST_FAILED)
    } finally {
      setStarting(false)
    }
  }

  return { starting, error, start }
}

/**
 * Whether the form can create: never while a project session starts; a project session or a continued conversation
 * runs on the device's own sign-in; otherwise the own sign-in or an available profile launch.
 */
export function readyToCreate(state: {
  starting: boolean
  inProject: boolean
  resume: string | undefined
  native: boolean
  profileLaunch: boolean
}) {
  if (state.starting) return false

  return state.inProject || state.resume ? state.native : state.native || state.profileLaunch
}
