import { useCallback, useState, useSyncExternalStore } from "react"

/**
 * Draft text per session, kept outside React state: a keystroke re-renders only what subscribes to it (the composer),
 * not the application that owns the command controller.
 */
export class DraftTexts {
  private texts = new Map<string, string>()
  private listeners = new Set<() => void>()

  get(id: string | undefined) {
    return id ? (this.texts.get(id) ?? "") : ""
  }

  set(id: string, text: string) {
    if (this.get(id) === text) return
    this.texts.set(id, text)
    this.notify()
  }

  reset() {
    this.texts.clear()
    this.notify()
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }
}

export function useSessionDrafts(sessionId: string | undefined) {
  const [texts] = useState(() => new DraftTexts())

  const setPrompt = useCallback(
    (text: string) => {
      if (sessionId) texts.set(sessionId, text)
    },
    [texts, sessionId],
  )

  const reset = useCallback(() => texts.reset(), [texts])

  return {
    texts,
    /** The selected session's draft as it is now; reading it does not subscribe. */
    current: () => texts.get(sessionId),
    setPrompt,
    clear: (id: string, text: string) => {
      if (texts.get(id) === text) texts.set(id, "")
    },
    restore: (id: string, text: string) => texts.set(id, text),
    reset,
  }
}

/** A session's draft text, re-rendering only the component that reads it. */
export function useDraftText(texts: DraftTexts, sessionId: string | undefined) {
  return useSyncExternalStore(texts.subscribe, () => texts.get(sessionId))
}
