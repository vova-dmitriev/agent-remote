import { useState } from "react"
import { z } from "zod"
import { HttpRequestMethod } from "@protocol"
import { requestJson } from "@/shared/api"

const linkSchema = z.object({ refresh: z.string().min(1).max(128) })

/** Exchanges the code the owner typed for the refresh credential this client keeps. */
export function useLinkEntry(server: string, onLinked: (refresh: string) => void) {
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function submit() {
    setBusy(true)
    setFailed(false)

    try {
      // The server is the build's own HTTPS origin (VITE_EXTENSION_SERVER_ORIGIN), never one the page chose.
      const linked = await requestJson<unknown>(
        new URL("/auth/link", server).href,
        { method: HttpRequestMethod.Post, headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) },
        new Set(),
      )

      onLinked(linkSchema.parse(linked).refresh)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return { code, setCode, busy, failed, submit }
}
