import { useEffect, useState } from "react"
import { PromptStatus, useSessionStore, useSessionStoreApi } from "@/entities/session"
import { PromptDeliveryMode } from "@/features/send-command/config/values"
import { PromptDispatcher } from "./dispatcher"

export function usePromptOutbox(sessionId: string | undefined) {
  const store = useSessionStoreApi()
  const entries = useSessionStore((state) => state.outbox)

  useSessionStore((state) => state.session)
  const [dispatcher] = useState(() => new PromptDispatcher(store))

  useEffect(() => dispatcher.start(), [dispatcher])

  return {
    items: entries.filter((entry) => entry.command.sessionId === sessionId),
    cancel: store.getState().cancelPrompt,
    beginEdit: store.getState().beginPromptEdit,
    saveEdit: store.getState().savePromptEdit,
    cancelEdit: store.getState().cancelPromptEdit,
    sendNow: (id: string) => {
      void dispatcher.sendNow(id)
    },
    canSendNow: (id: string) => dispatcher.canSendNow(id),
    retry: (id: string) => {
      const item = store.getState().outbox.find((entry) => entry.command.commandId === id)

      if (item?.status === PromptStatus.Unknown) void dispatcher.deliver(item, PromptDeliveryMode.Retry)
    },
    check: (id: string) => {
      const item = store.getState().outbox.find((entry) => entry.command.commandId === id)

      if (item && [PromptStatus.Unknown, PromptStatus.Accepted].some((candidateValue) => candidateValue === item.status))
        void dispatcher.deliver(item, PromptDeliveryMode.Check)
    },
  }
}
