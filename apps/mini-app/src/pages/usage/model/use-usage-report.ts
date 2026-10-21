import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { AnalyticsPeriod, ErrorCode } from "@protocol"
import { useRuntime } from "@/shared/lib/runtime"
import { USAGE_IMPORT_POLL_MS } from "../config/values"

/** The device's usage for the chosen period, asked for again while its first import runs. */
export function useUsageReport(deviceId: string, online: boolean) {
  const runtime = useRuntime()
  const [period, setPeriod] = useState<AnalyticsPeriod>(AnalyticsPeriod.Week)

  const query = useQuery({
    queryKey: ["usage", runtime.epoch, deviceId, period],
    queryFn: () => {
      if (!runtime.client) throw new Error(ErrorCode.NO_AUTHENTICATED_CLIENT)

      return runtime.client.usageReport(deviceId, period)
    },
    enabled: online,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (state) => (state.state.data?.importing ? USAGE_IMPORT_POLL_MS : false),
  })

  return { period, setPeriod, query }
}
