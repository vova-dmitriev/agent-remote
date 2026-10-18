import { useEffect, useEffectEvent, useRef, useState } from "react"
import { ConnectionStatus, ErrorCode, type Session } from "@protocol"
import { useSessionStore, useSessionStoreApi } from "@/entities/session"
import { useRuntime } from "@/shared/lib/runtime"
import type { useSessionDrafts } from "../use-session-drafts"
import type { useAttachmentDrafts } from "../use-attachment-drafts"
import { DraftState } from "./draft-state"
import { PERSISTENCE_SAVE_DELAY_MS } from "./values"
import { restoreAttachments } from "./restore-attachments"

export function usePersistedDraft(
  selected: Session | undefined,
  drafts: ReturnType<typeof useSessionDrafts>,
  attachments: ReturnType<typeof useAttachmentDrafts>,
) {
  const runtime = useRuntime()
  const store = useSessionStoreApi()
  const state = useRef<DraftState | null>(null)
  const [loaded, setLoaded] = useState("")
  const scope = JSON.stringify([selected?.id, selected?.generation, runtime.epoch])
  const ready = loaded === scope
  const client = runtime.client
  const connection = useSessionStore((value) => value.session.connection)

  const contents = JSON.stringify({
    text: drafts.prompt,
    attachments: attachments.items.flatMap((item) => ((item.descriptor ?? item.reference) ? [item.descriptor ?? item.reference!] : [])),
  })

  const latest = useEffectEvent(() => contents)

  const restore = useEffectEvent(async (controller: AbortController) => {
    if (!selected || !client?.persistence) return
    const lease = runtime.current()
    const current = () => runtime.isCurrent(lease) && !controller.signal.aborted
    const draft = new DraftState(client.persistence, selected.id, selected.generation, current)
    const before = latest()

    state.current = draft

    try {
      const saved = await draft.load()
      const items = await restoreAttachments(client.attachments, selected.id, saved.attachments, controller.signal)

      if (!current()) return

      if (before === latest()) {
        drafts.restore(selected.id, saved.text)
        attachments.restore(selected.id, items)
      }

      setLoaded(scope)
    } catch (error) {
      if (current()) store.getState().setError(error instanceof Error ? error.message : ErrorCode.REQUEST_FAILED)
    }
  })

  useEffect(() => {
    const controller = new AbortController()

    void restore(controller)

    return () => {
      void state.current?.flush().catch(() => {})
      controller.abort()
      state.current = null
    }
  }, [client, scope])

  useEffect(() => {
    if (connection !== ConnectionStatus.Online || !client?.persistence) return
    const draft = state.current
    const lease = runtime.current()

    void draft?.reconcile().catch((error: unknown) => {
      if (runtime.isCurrent(lease) && state.current === draft)
        store.getState().setError(error instanceof Error ? error.message : ErrorCode.REQUEST_FAILED)
    })
  }, [connection, client, store, runtime])

  useEffect(() => {
    if (!ready || !client?.persistence) return
    const value = JSON.parse(contents) as { text: string; attachments: Parameters<DraftState["update"]>[1] }

    state.current?.update(value.text, value.attachments)

    const timer = setTimeout(() => {
      void state.current
        ?.flush()
        .catch((error: unknown) => store.getState().setError(error instanceof Error ? error.message : ErrorCode.REQUEST_FAILED))
    }, PERSISTENCE_SAVE_DELAY_MS)

    return () => clearTimeout(timer)
  }, [contents, ready, client, store])

  return {
    ready: !client?.persistence || ready,
    flush: () => state.current?.flush() ?? Promise.resolve(),
    refresh: () => state.current?.load(),
  }
}
