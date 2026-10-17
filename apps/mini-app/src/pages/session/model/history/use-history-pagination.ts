import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react"
import { HistoryDirection, type HistoryPageDirection } from "@protocol"

export function useHistoryPagination(
  scroll: RefObject<HTMLDivElement | null>,
  restoring: RefObject<boolean>,
  enabled: boolean,
  load?: (direction: HistoryPageDirection) => void,
) {
  const callback = useRef(load)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useLayoutEffect(() => {
    callback.current = load
  }, [load])

  const finish = useCallback(() => {
    clearTimeout(timer.current)
    const root = scroll.current

    if (!enabled || !root || restoring.current) return
    if (root.scrollTop < 80) callback.current?.(HistoryDirection.Before)
    else if (root.scrollHeight - root.scrollTop - root.clientHeight < 80) callback.current?.(HistoryDirection.After)
  }, [enabled, restoring, scroll])

  useEffect(() => {
    const root = scroll.current

    root?.addEventListener("scrollend", finish)

    return () => {
      root?.removeEventListener("scrollend", finish)
      clearTimeout(timer.current)
    }
  }, [finish, scroll])

  return useCallback(() => {
    clearTimeout(timer.current)
    if (enabled) timer.current = setTimeout(finish, 180)
  }, [enabled, finish])
}
