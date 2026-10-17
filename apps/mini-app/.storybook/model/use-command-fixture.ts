import { useState } from "react"
import type { CommandController } from "@/features/send-command"

export function useCommandFixture(): CommandController {
  const [prompt, setPrompt] = useState("")

  return {
    createdSessionId: null,
    consumeCreatedSession: () => {},
    prompt,
    setPrompt,
    busy: false,
    uncertain: false,
    pendingUserInputs: [],
    awaitingReceipt: false,
    outbox: {
      items: [],
      cancel: () => {},
      retry: () => {},
      check: () => {},
      beginEdit: () => false,
      saveEdit: () => false,
      cancelEdit: () => {},
      sendNow: () => {},
      canSendNow: () => false,
    },
    attachments: {
      items: [],
      error: "",
      ready: true,
      add: () => {},
      remove: () => {},
      retry: () => {},
      reset: () => {},
      complete: () => {},
    },
    action: async () => {
      setPrompt("")
    },
    retry: async () => {},
    submit: (event) => {
      event.preventDefault()
      setPrompt("")
    },
    reset: () => setPrompt(""),
  }
}
