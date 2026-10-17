import { useEffect, useRef } from "react"

export function useViewerDialog() {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    const rootOverflow = document.documentElement.style.overflow

    document.body.style.overflow = "hidden"
    document.documentElement.style.overflow = "hidden"
    element?.showModal()

    return () => {
      element?.close()
      document.body.style.overflow = overflow
      document.documentElement.style.overflow = rootOverflow
      if (focused?.isConnected) focused.focus({ preventScroll: true })
    }
  }, [])

  return dialog
}
