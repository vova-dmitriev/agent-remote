import { useCallback } from "react"
import { ErrorCode, type ProfileRequest } from "@protocol"
import { useRuntime } from "@/shared/lib/runtime"

export function useProfileAccess(deviceId: string) {
  const runtime = useRuntime()
  const lease = runtime.current()

  return useCallback(
    async (input: ProfileRequest) => {
      if (!runtime.isCurrent(lease)) throw new Error(ErrorCode.NO_AUTHENTICATED_CLIENT)
      const access = lease?.client.profiles?.(deviceId)

      if (!access) throw new Error(ErrorCode.CAPABILITY_UNAVAILABLE)
      const response = await access.request(input)

      if (!runtime.isCurrent(lease)) throw new Error(ErrorCode.STALE_EPOCH)

      return response
    },
    [deviceId, runtime, lease],
  )
}
