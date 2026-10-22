import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { AnalyticsPeriod, ErrorCode, type AnalyticsQuery } from "@protocol"
import { useRuntime } from "@/shared/lib/runtime"
import { USAGE_IMPORT_POLL_MS } from "../config/values"

type UsageFilter = Omit<AnalyticsQuery, "period">

/**
 * The device's usage for the chosen period, narrowed to a picked session and day, asked for again while its first
 * import runs. A page opened for one session shows all its time.
 */
export function useUsageReport(deviceId: string, online: boolean, session: string | null) {
  const runtime = useRuntime()
  const [period, setPeriod] = useState<AnalyticsPeriod>(session ? AnalyticsPeriod.All : AnalyticsPeriod.Week)
  const [filter, setFilter] = useState<UsageFilter>(session ? { session } : {})

  const query = useQuery({
    queryKey: ["usage", runtime.epoch, deviceId, period, filter.session, filter.day],
    queryFn: () => {
      if (!runtime.client) throw new Error(ErrorCode.NO_AUTHENTICATED_CLIENT)

      return runtime.client.usageReport(deviceId, { period, ...filter })
    },
    enabled: online,
    retry: false,
    refetchOnWindowFocus: false,
    // A picked day or session keeps the last report on screen until its own arrives.
    placeholderData: keepPreviousData,
    refetchInterval: (state) => (state.state.data?.importing ? USAGE_IMPORT_POLL_MS : false),
  })

  /** Picks a filter value, or drops it when it is already picked or undefined. */
  const pick = (key: keyof UsageFilter) => (value: string | undefined) =>
    setFilter(({ [key]: current, ...rest }) => (value === undefined || value === current ? rest : { ...rest, [key]: value }))

  return {
    period,
    // Another period may not hold the picked day.
    setPeriod: (next: AnalyticsPeriod) => {
      setPeriod(next)
      setFilter(({ day: _day, ...rest }) => rest)
    },
    filter,
    pickDay: pick("day"),
    pickSession: pick("session"),
    query,
  }
}
