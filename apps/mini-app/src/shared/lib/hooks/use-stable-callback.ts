import { useCallback, useLayoutEffect, useRef } from "react"

/** A callback with a stable identity that always calls the latest render's function (for memoized children). */
export function useStableCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const latest = useRef(callback)

  useLayoutEffect(() => {
    latest.current = callback
  })

  return useCallback((...args: Args) => latest.current(...args), [])
}
