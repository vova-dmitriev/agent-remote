import { PointerKind } from "@/shared/lib/pointer"
import { useEffect, useRef, type PointerEvent } from "react"
import { VIEWER_WHEEL_SENSITIVITY } from "../config/viewer"
import type { Point } from "../lib/image-transform"
import type { useImageTransform } from "./use-image-transform"

type Model = ReturnType<typeof useImageTransform>
const center = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

export function useImageGestures(model: Model) {
  const pointers = useRef(new Map<number, Point>())
  const { stage, zoomBy, pan, current, fit, original } = model

  const relative = (point: Point) => {
    const bounds = stage.current!.getBoundingClientRect()

    return { x: point.x - bounds.left - bounds.width / 2, y: point.y - bounds.top - bounds.height / 2 }
  }

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === PointerKind.Mouse && event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId)

    if (!previous) return
    const before = [...pointers.current.values()]
    const next = { x: event.clientX, y: event.clientY }

    pointers.current.set(event.pointerId, next)

    if (before.length === 1) pan(next.x - previous.x, next.y - previous.y)
    else {
      const after = [...pointers.current.values()]
      const oldCenter = center(before[0]!, before[1]!)
      const newCenter = center(after[0]!, after[1]!)
      const oldDistance = distance(before[0]!, before[1]!)

      if (oldDistance > 0) zoomBy(distance(after[0]!, after[1]!) / oldDistance, relative(oldCenter))
      pan(newCenter.x - oldCenter.x, newCenter.y - oldCenter.y)
    }
  }

  const up = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  useEffect(() => {
    const root = stage.current

    if (!root) return

    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const bounds = root.getBoundingClientRect()

      if (event.shiftKey || (!event.ctrlKey && Math.abs(event.deltaX) > 0)) pan(-event.deltaX, -event.deltaY)
      else
        zoomBy(Math.exp(-event.deltaY * VIEWER_WHEEL_SENSITIVITY), {
          x: event.clientX - bounds.left - bounds.width / 2,
          y: event.clientY - bounds.top - bounds.height / 2,
        })
    }

    root.addEventListener("wheel", wheel, { passive: false })

    return () => root.removeEventListener("wheel", wheel)
  }, [stage, zoomBy, pan])

  const doubleClick = () => {
    if (Math.abs(current.current.scale - 1) < 0.01) fit()
    else original()
  }

  return {
    onPointerDown: down,
    onPointerMove: move,
    onPointerUp: up,
    onPointerCancel: up,
    onLostPointerCapture: up,
    onDoubleClick: doubleClick,
  }
}
