import { useState } from "react"
import { DraftTexts, type CommandController } from "@/features/send-command"

/** One draft for whichever session the story shows. */
class StoryDrafts extends DraftTexts {
  override get() {
    return super.get(STORY_DRAFT)
  }
}

const STORY_DRAFT = "story"

export function useCommandFixture(): CommandController {
  const [drafts] = useState(() => new StoryDrafts())
  const setPrompt = (text: string) => drafts.set(STORY_DRAFT, text)

  return {
    createdSessionId: null,
    consumeCreatedSession: () => {},
    drafts,
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
