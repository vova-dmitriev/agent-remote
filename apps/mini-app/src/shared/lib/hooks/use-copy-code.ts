import { useEffect, useState } from "react"
import { CopyStatus } from "./copy-status"

export function useCopyCode(text: string) {
  const [status, setStatus] = useState<CopyStatus>(CopyStatus.Idle)

  useEffect(() => {
    if (status === CopyStatus.Idle) return
    const timer = window.setTimeout(() => setStatus(CopyStatus.Idle), 2500)

    return () => window.clearTimeout(timer)
  }, [status])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setStatus(CopyStatus.Copied)
    } catch {
      setStatus(CopyStatus.Failed)
    }
  }

  return { status, copy }
}
