import { useId, useRef, useState, type KeyboardEvent } from "react"
import { useQuery } from "@tanstack/react-query"
import { CodedError, ErrorCode, type SessionSkill } from "@protocol"
import { useRuntime } from "@/shared/lib/runtime"
import { SLASH_SKILLS_QUERY, SLASH_SKILLS_STALE_MS } from "@/features/send-command/config/slash-skills"
import { insertSkill, matchingSkills, slashQuery } from "@/features/send-command/lib/slash-skills"
import type { SlashSkillsInput } from "./types"

export function useSlashSkills({ session, prompt, disabled, setPrompt }: SlashSkillsInput) {
  const runtime = useRuntime()
  const input = useRef<HTMLTextAreaElement>(null)
  const listId = useId()
  const [caret, setCaret] = useState(prompt.length)
  const [dismissed, setDismissed] = useState(false)
  const [selected, setSelected] = useState(0)
  const query = slashQuery(prompt, caret)
  const open = query !== null && !disabled && !dismissed

  const skills = useQuery({
    queryKey: [SLASH_SKILLS_QUERY, runtime.epoch, session.target.deviceId, session.id, session.generation],
    queryFn: async () => {
      const lease = runtime.current()

      if (!lease?.client.sessionSkills) throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE)
      const result = await lease.client.sessionSkills(session.id, session.generation)

      if (!runtime.isCurrent(lease)) throw new CodedError(ErrorCode.STALE_EPOCH)

      return result
    },
    enabled: open && !!runtime.client?.sessionSkills,
    retry: false,
    staleTime: SLASH_SKILLS_STALE_MS,
    refetchOnWindowFocus: false,
  })

  const items = matchingSkills(skills.data?.skills ?? [], query ?? "")
  const active = Math.min(selected, Math.max(0, items.length - 1))

  function pick(skill: SessionSkill) {
    if (disabled) return
    const next = insertSkill(prompt, skill.invocation)
    const element = input.current

    setPrompt(next.text)
    setCaret(next.caret)
    setDismissed(true)

    requestAnimationFrame(() => {
      if (input.current !== element || !element?.isConnected) return
      element.focus()
      element.setSelectionRange(next.caret, next.caret)
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open || event.nativeEvent.isComposing || event.keyCode === 229) return false

    if (event.key === "Escape") {
      event.preventDefault()
      setDismissed(true)

      return true
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      if (!event.repeat && items.length) pick(items[active]!)

      return true
    }

    if (!items.length) return false

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return false
    event.preventDefault()
    const next = (active + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length

    setSelected(next)
    requestAnimationFrame(() => document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" }))

    return true
  }

  return {
    input,
    listId,
    open,
    items,
    active,
    pick,
    onKeyDown,
    loading: skills.isLoading,
    failed: skills.isError,
    supported: skills.data?.supported ?? false,
    truncated: skills.data?.truncated ?? false,
    retry: () => void skills.refetch(),
    highlight: setSelected,
    dismiss: () => setDismissed(true),
    focus: (position: number) => {
      setCaret(position)
      setDismissed(false)
    },
    position: setCaret,
    change: (text: string, position: number) => {
      setPrompt(text)
      setCaret(position)
      setSelected(0)
      setDismissed(false)
    },
  }
}
