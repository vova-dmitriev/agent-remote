import { useEffect, useState } from "react"
import { SIDEBAR_CLOCK_TICK_MS } from "../config/values"

/** The reference time for groups and relative labels: a fixed value (stories) or `Date.now()` refreshed every tick. */
export function useSidebarClock(fixed: number | undefined) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (fixed !== undefined) return

    const timer = window.setInterval(() => setNow(Date.now()), SIDEBAR_CLOCK_TICK_MS)

    return () => window.clearInterval(timer)
  }, [fixed])

  return fixed ?? now
}
