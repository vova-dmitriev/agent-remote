import { useCallback, useState } from "react"

export function useSessionDrafts(sessionId: string | undefined) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  function setPrompt(text: string) {
    if (sessionId) setDrafts((current) => ({ ...current, [sessionId]: text }))
  }

  function clear(id: string, text: string) {
    setDrafts((current) => (current[id] === text ? { ...current, [id]: "" } : current))
  }

  const restore = (id: string, text: string) => setDrafts((current) => ({ ...current, [id]: text }))

  const reset = useCallback(() => setDrafts({}), [])

  return { prompt: sessionId ? (drafts[sessionId] ?? "") : "", setPrompt, clear, restore, reset }
}
