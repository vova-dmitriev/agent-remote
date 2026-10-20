import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { useTranslation } from "@/shared/lib/hooks"
import { SESSION_SIDEBAR_IDS } from "@/widgets/session-sidebar/config/test-ids"
import { SidebarWidth } from "@/widgets/session-sidebar/config/values"
import { keyedSidebarWidth } from "@/widgets/session-sidebar/lib/sidebar-width"
import type { SidebarResizeHandleProps } from "../session-sidebar.types"

/** Drag strip on the sidebar's right edge: drag to resize, double-click to reset, arrows/Home/End from the keyboard. */
export function SidebarResizeHandle({ width, onResize, onReset }: SidebarResizeHandleProps) {
  const { t } = useTranslation()
  const drag = useRef<{ x: number; width: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const follow = (event: PointerEvent<HTMLDivElement>, done: boolean) => {
    if (!drag.current) return
    onResize(drag.current.width + event.clientX - drag.current.x, done)
    if (!done) return
    drag.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = keyedSidebarWidth(event.key, width)

    if (next === undefined) return
    event.preventDefault()
    onResize(next, true)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("sidebarResize")}
      aria-valuenow={width}
      aria-valuemin={SidebarWidth.Min}
      aria-valuemax={SidebarWidth.Max}
      tabIndex={0}
      data-testid={SESSION_SIDEBAR_IDS.resize}
      data-dragging={dragging}
      className="absolute inset-y-0 -right-[3px] z-10 w-[6px] cursor-col-resize touch-none outline-none select-none hover:bg-primary/30 focus-visible:bg-primary/40 data-[dragging=true]:bg-primary/40"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { x: event.clientX, width }
        setDragging(true)
      }}
      onPointerMove={(event) => follow(event, false)}
      onPointerUp={(event) => follow(event, true)}
      onPointerCancel={(event) => follow(event, true)}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  )
}
