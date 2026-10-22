import { useEffect, useState } from "react"
import { useStableCallback } from "@/shared/lib/hooks"
import { useRuntime } from "@/shared/lib/runtime"

/** A fresh link code while the dialog is open, and the clock it runs out on; a new code replaces an expired one. */
export function useLinkCode(open: boolean) {
  const runtime = useRuntime()
  const [link, setLink] = useState<{ code: string; expiresAt: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const [now, setNow] = useState(Date.now)

  const issue = useStableCallback(async () => {
    const lease = runtime.current()

    setFailed(false)
    setLink(null)

    try {
      if (!lease?.client.createLinkCode) throw new Error()
      const issued = await lease.client.createLinkCode()

      if (runtime.isCurrent(lease)) setLink(issued)
    } catch {
      setFailed(true)
    }
  })

  useEffect(() => {
    if (open) void issue()
  }, [open, issue])

  useEffect(() => {
    if (!open) return
    const timer = setInterval(() => setNow(Date.now()), 1000)

    return () => clearInterval(timer)
  }, [open])

  return { link, failed, left: link ? link.expiresAt - now : 0, issue }
}
