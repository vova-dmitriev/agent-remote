import { ErrorCode, type ProviderFilterValue } from "@protocol"
import { useStableCallback } from "@/shared/lib/hooks"
import { useRuntime } from "@/shared/lib/runtime"

export function useSessionPageLoader(deviceId: string | null, streamId: string | null) {
  const runtime = useRuntime()
  const scope = `${runtime.epoch}:${deviceId ?? ""}:${streamId ?? ""}`
  const supportsPages = !!runtime.current()?.client.listSessions

  const loadPage = useStableCallback(async (provider: ProviderFilterValue, cursor?: string) => {
    const lease = runtime.current()

    if (!deviceId || !lease?.client.listSessions) throw new Error(ErrorCode.CAPABILITY_UNAVAILABLE)
    const page = await lease.client.listSessions(deviceId, provider, cursor)

    if (!runtime.isCurrent(lease)) throw new Error(ErrorCode.STALE_EPOCH)

    return page
  })

  return { scope, loadPage: supportsPages ? loadPage : undefined }
}
