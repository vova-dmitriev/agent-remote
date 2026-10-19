import { useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ErrorCode, ProfileRequestKind, ProfileOperationPhase, knownErrorCode, type ProfileRequest, type ProfileLogin } from "@protocol"
import { profileKeys, useProfileAccess } from "@/entities/execution-profile"
import { useRuntime } from "@/shared/lib/runtime"
import type { ProfileTask } from "@/shared/api"
import { ProfileOperationJournal } from "@/pages/accounts/lib/management/operation-journal"

export function useProfileManagement(deviceId: string) {
  const cache = useQueryClient()
  const runtime = useRuntime()
  const send = useProfileAccess(deviceId)
  const journal = useMemo(() => new ProfileOperationJournal(deviceId, localStorage), [deviceId])
  const [pending, setPending] = useState(() => journal.pending())
  const running = useRef(false)
  const loginOperation = useRef<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [login, setLogin] = useState<ProfileLogin | null>(null)

  async function perform(task: ProfileTask) {
    if (running.current) return null
    const lease = runtime.current()

    running.current = true
    setBusy(true)
    setError("")

    try {
      const response = await task((input) => journal.request(send, input))

      if (!runtime.isCurrent(lease)) return null

      if (response.kind === ProfileRequestKind.Authenticate) {
        setLogin(response.login ?? null)
        loginOperation.current = response.data.id
      } else if (
        response.data !== null &&
        "phase" in response.data &&
        response.data.id === loginOperation.current &&
        response.data.phase !== ProfileOperationPhase.AwaitingAuthentication
      ) {
        setLogin(null)
        loginOperation.current = null
      }

      if (
        response.data !== null &&
        "phase" in response.data &&
        (response.data.phase === ProfileOperationPhase.Failed || response.data.phase === ProfileOperationPhase.Unknown)
      ) {
        setError(response.data.code ?? ErrorCode.REQUEST_FAILED)
      }

      return runtime.isCurrent(lease) ? response : null
    } catch (failure) {
      if (runtime.isCurrent(lease)) setError(knownErrorCode(failure))

      return null
    } finally {
      if (runtime.isCurrent(lease)) {
        setPending(journal.pending())
        await cache.invalidateQueries({ queryKey: profileKeys.list(lease!.epoch, deviceId) }).catch(() => {})
      }

      running.current = false
      setBusy(false)
    }
  }

  return {
    busy,
    error,
    login,
    pending,
    perform,
    recover: () => (pending ? perform((request) => request({ kind: ProfileRequestKind.Reconcile, operationId: pending })) : null),
    run: (input: ProfileRequest) => perform((request) => request(input)),
  }
}
