import { useEffect, useRef, useState, type PointerEvent } from "react"

export function useStatusDetails() {
  const [open, setOpen] = useState(false)
  const pinned = useRef(false)
  const focused = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancelClose = () => clearTimeout(timer.current)

  useEffect(() => () => clearTimeout(timer.current), [])

  function onOpenChange(value: boolean) {
    cancelClose()

    if (!value) pinned.current = false
    setOpen(value)
  }

  function onPointerEnter(event: PointerEvent) {
    if (event.pointerType !== "mouse") return
    cancelClose()
    setOpen(true)
  }

  function onPointerLeave(event: PointerEvent) {
    if (event.pointerType !== "mouse" || pinned.current || focused.current) return
    cancelClose()
    timer.current = setTimeout(() => setOpen(false), 120)
  }

  function onClick(event: { preventDefault: () => void }) {
    event.preventDefault()
    cancelClose()
    pinned.current = !pinned.current
    setOpen(pinned.current)
  }

  return {
    open,
    onOpenChange,
    onPointerEnter,
    onPointerLeave,
    onClick,
    onFocus: () => {
      cancelClose()
      focused.current = true
      setOpen(true)
    },
    onBlur: () => {
      focused.current = false

      if (!pinned.current) setOpen(false)
    },
  }
}
