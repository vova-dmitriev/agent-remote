import { PointerKind } from "@/shared/lib/pointer"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import type { HistoryMessage } from "@protocol"
import { PreviewSource } from "../config/message-navigation"
import { previewDismissal } from "../lib/message-navigation"

type Target = { id: string; node: HTMLElement; source?: PreviewSource }

export function useMessagePreview(messages: HistoryMessage[]) {
  const id = useId()
  const gate = useRef<ReturnType<typeof previewDismissal> | null>(null)
  const [target, setTarget] = useState<Target | null>(null)
  const hovered = useRef<Target | null>(null)
  const focused = useRef<Target | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  function keep() {
    clearTimeout(timer.current)
  }

  function show(messageId: string, node: HTMLElement, source: PreviewSource) {
    keep()

    gate.current ??= previewDismissal()

    if (!gate.current.allows(messageId, source)) return
    const next = { id: messageId, node, source }

    if (source === PreviewSource.Focus) focused.current = next
    else hovered.current = next
    setTarget((current) => (current?.id === messageId && current.node === node && current.source === source ? current : next))
  }

  function hide(source: PreviewSource) {
    if (source === PreviewSource.Focus) gate.current?.leave(source)
    if (source === PreviewSource.Focus) focused.current = null
    else hovered.current = null
    keep()
    timer.current = setTimeout(() => setTarget(focused.current ?? hovered.current), 150)
  }

  const dismiss = useCallback((messageId?: string) => {
    const dismissedId = messageId ?? focused.current?.id ?? hovered.current?.id

    gate.current ??= previewDismissal()

    if (dismissedId) gate.current.dismiss(dismissedId, messageId ? undefined : focused.current ? PreviewSource.Focus : PreviewSource.Hover)
    clearTimeout(timer.current)
    hovered.current = null
    focused.current = null
    setTarget(null)
  }, [])

  useEffect(() => {
    if (!target) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss()
    }

    // On a touch screen a tap outside the preview and its marker closes it; another marker's tap opens its own.
    const onPointerDown = (event: PointerEvent) => {
      const node = event.target instanceof Node ? event.target : null

      if (event.pointerType === PointerKind.Mouse || !node) return
      if (target.node.contains(node) || document.getElementById(id)?.contains(node)) return
      dismiss()
    }

    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("pointerdown", onPointerDown)

    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("pointerdown", onPointerDown)
    }
  }, [target, dismiss, id])

  useEffect(() => () => clearTimeout(timer.current), [])
  const message = target ? messages.find((item) => item.id === target.id) : undefined

  function releaseHover() {
    gate.current?.leave(PreviewSource.Hover)
  }

  return { id, target, message, show, hide, keep, dismiss, releaseHover }
}
