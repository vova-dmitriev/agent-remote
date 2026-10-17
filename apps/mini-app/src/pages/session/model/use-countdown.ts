import { useEffect, useState } from "react"

export function useCountdown(expiresAt: number) {
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)

    return () => clearInterval(timer)
  }, [])

  return Math.max(0, Math.ceil((expiresAt - now) / 1000))
}
