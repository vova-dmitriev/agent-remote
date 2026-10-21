import { useEffect, useState } from "react"
import { LIMIT_CLOCK_TICK_MS } from "../config/values"

/** The time reset labels count from: a fixed value (stories) or `Date.now()` refreshed every minute. */
export function useLimitClock(fixed: number | undefined) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (fixed !== undefined) return

    const timer = window.setInterval(() => setNow(Date.now()), LIMIT_CLOCK_TICK_MS)

    return () => window.clearInterval(timer)
  }, [fixed])

  return fixed ?? now
}
