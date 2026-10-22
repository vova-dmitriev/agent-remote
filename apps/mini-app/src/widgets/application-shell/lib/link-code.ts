/** A link code as the owner reads it: two groups of four. */
export const displayCode = (code: string) => code.slice(0, 4) + "-" + code.slice(4)

/** Minutes and seconds left, as m:ss. */
export function timeLeft(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000))

  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0")
}
