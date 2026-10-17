import { useCallback, useLayoutEffect, useRef, useState, type SyntheticEvent } from "react"
import { clampTransform, fitScale, zoomAt, type Point, type Size, type Transform } from "../lib/image-transform"
import { VIEWER_MAX_SCALE, VIEWER_MIN_FIT_RATIO } from "../config/viewer"

const emptySize = { width: 1, height: 1 }

export function useImageTransform() {
  const stage = useRef<HTMLDivElement>(null)
  const image = useRef<Size>(emptySize)
  const viewport = useRef<Size>(emptySize)
  const current = useRef<Transform>({ scale: 1, x: 0, y: 0 })
  const [transform, setTransform] = useState(current.current)

  const apply = useCallback((next: Transform) => {
    current.current = clampTransform(next, image.current, viewport.current)
    setTransform(current.current)
  }, [])

  const fit = useCallback(() => apply({ scale: fitScale(image.current, viewport.current), x: 0, y: 0 }), [apply])
  const original = useCallback(() => apply({ scale: 1, x: 0, y: 0 }), [apply])

  const zoom = useCallback(
    (scale: number, point: Point = { x: 0, y: 0 }) => {
      const minimum = fitScale(image.current, viewport.current) * VIEWER_MIN_FIT_RATIO
      const bounded = Math.max(minimum, Math.min(VIEWER_MAX_SCALE, scale))

      apply(zoomAt(current.current, bounded, point, image.current, viewport.current))
    },
    [apply],
  )

  const zoomBy = useCallback((factor: number, point?: Point) => zoom(current.current.scale * factor, point), [zoom])

  const pan = useCallback(
    (dx: number, dy: number) => apply({ ...current.current, x: current.current.x + dx, y: current.current.y + dy }),
    [apply],
  )

  const loaded = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      image.current = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }
      fit()
    },
    [fit],
  )

  useLayoutEffect(() => {
    const root = stage.current

    if (!root) return

    const measure = () => {
      viewport.current = { width: Math.max(1, root.clientWidth), height: Math.max(1, root.clientHeight) }
      fit()
    }

    const observer = new ResizeObserver(measure)

    measure()
    observer.observe(root)

    return () => observer.disconnect()
  }, [fit])

  return { stage, image, viewport, current, transform, loaded, fit, original, zoom, zoomBy, pan }
}
