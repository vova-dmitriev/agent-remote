import { useEffect, useState } from "react"
import { ConnectionStatus } from "@protocol"
import { PROMPT_RECEIPT_POLL_MS, PromptStatus, useSessionStore, useSessionStoreApi } from "@/entities/session"
import { PromptDeliveryMode } from "@/features/send-command/config/values"
import { ManagedQueue } from "../persistence/managed-queue"
import { PromptDispatcher } from "./dispatcher"

export function usePromptOutbox(sessionId: string | undefined) {
  const store = useSessionStoreApi()
  const entries = useSessionStore((state) => state.outbox)

  const session = useSessionStore((state) => state.session)
  const client = store.getState().runtime.client
  const [dispatcher] = useState(() => new PromptDispatcher(store))
  const [managed] = useState(() => new ManagedQueue(store))

  useEffect(() => managed.start(), [managed, client])

  useEffect(() => (client?.persistence ? undefined : dispatcher.start()), [dispatcher, client])

  useEffect(() => {
    if (!client?.persistence || !store.getState().session.snapshot) return
    let stopped = false

    const refresh = () => {
      if (store.getState().session.connection !== ConnectionStatus.Online) return
      for (const item of store.getState().session.snapshot?.sessions ?? [])
        void managed.refresh(item.id).catch((error: unknown) => {
          if (!stopped) store.getState().setError(error instanceof Error ? error.message : "")
        })
    }

    refresh()
    const timer = setInterval(refresh, PROMPT_RECEIPT_POLL_MS)

    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [client, managed, session.connection, session.snapshot?.cursor.streamId, store])

  const report = (work: Promise<unknown>) =>
    void work.catch((error: unknown) => store.getState().setError(error instanceof Error ? error.message : ""))

  return {
    items: entries.filter((entry) => entry.command.sessionId === sessionId),
    ...(client?.persistence ? { enqueue: managed.enqueue.bind(managed) } : {}),
    cancel: (id: string) => (client?.persistence ? report(managed.cancel(id)) : store.getState().cancelPrompt(id)),
    beginEdit: store.getState().beginPromptEdit,
    saveEdit: (id: string, text: string) => (client?.persistence ? managed.saveEdit(id, text) : store.getState().savePromptEdit(id, text)),
    cancelEdit: store.getState().cancelPromptEdit,
    sendNow: (id: string) => {
      if (client?.persistence) report(managed.sendNow(id))
      else void dispatcher.sendNow(id)
    },
    canSendNow: (id: string) => (client?.persistence ? managed.canSendNow(id) : dispatcher.canSendNow(id)),
    retry: (id: string) => {
      const item = store.getState().outbox.find((entry) => entry.command.commandId === id)

      if (client?.persistence) report(managed.check(id))
      else if (item?.status === PromptStatus.Unknown) void dispatcher.deliver(item, PromptDeliveryMode.Retry)
    },
    check: (id: string) => {
      const item = store.getState().outbox.find((entry) => entry.command.commandId === id)

      if (client?.persistence) {
        report(managed.check(id))

        return
      }

      if (item && [PromptStatus.Unknown, PromptStatus.Accepted].some((candidateValue) => candidateValue === item.status))
        void dispatcher.deliver(item, PromptDeliveryMode.Check)
    },
  }
}
