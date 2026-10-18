import { useQueryClient } from "@tanstack/react-query"
import { ErrorCode } from "@protocol"
import { deviceKeys } from "@/entities/device"
import { useSessionStoreApi } from "@/entities/session"
import { useRuntime } from "@/shared/lib/runtime"

export function useRevokeDevice(reset: () => void) {
  const runtime = useRuntime()
  const { setError } = useSessionStoreApi().getState()
  const cache = useQueryClient()

  return async (id: string) => {
    const lease = runtime.current()

    if (!lease) return setError(ErrorCode.NO_AUTHENTICATED_CLIENT)

    try {
      await lease.client.revokeDevice(id)
      if (!runtime.isCurrent(lease)) return
      reset()
      await cache.invalidateQueries({ queryKey: deviceKeys.all })
    } catch (error) {
      if (runtime.isCurrent(lease)) setError(error instanceof Error ? error.message : ErrorCode.REVOKE_FAILED)
    }
  }
}
