import { useQuery } from "@tanstack/react-query"
import { ErrorCode } from "@protocol"
import { useRuntime } from "@/shared/lib/runtime"

export const deviceKeys = { all: ["devices"] as const, list: (epoch: number) => ["devices", epoch] as const }

export function useDevices(enabled: boolean) {
  const runtime = useRuntime()

  return useQuery({
    queryKey: deviceKeys.list(runtime.epoch),
    queryFn: () => {
      if (!runtime.client) throw new Error(ErrorCode.NO_AUTHENTICATED_CLIENT)

      return runtime.client.devices()
    },
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (query.state.data?.length === 0 ? 2000 : false),
  })
}
