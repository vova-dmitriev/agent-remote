import { useQuery } from "@tanstack/react-query"
import { ErrorCode, ProfileRequestKind } from "@protocol"
import { useRuntime } from "@/shared/lib/runtime"
import { profileKeys } from "../config/query-keys"
import { useProfileAccess } from "./use-profile-access"

export function useExecutionProfiles(deviceId: string, online: boolean) {
  const runtime = useRuntime()
  const request = useProfileAccess(deviceId)

  return useQuery({
    queryKey: [...profileKeys.list(runtime.epoch, deviceId), online],
    queryFn: async () => {
      const result = await request({ kind: ProfileRequestKind.List })

      if (result.kind !== ProfileRequestKind.List) throw new Error(ErrorCode.INVALID_FRAME)

      return result.data
    },
    enabled: !!runtime.client && !!deviceId,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 10_000,
  })
}
