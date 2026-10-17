import { createStore } from "zustand/vanilla"
import { READING_POSITION_LIMITS, READING_POSITION_STORAGE_KEY } from "./limits"

export interface ReadingPosition {
  cursor?: string | undefined
  messageId: string
  offset: number
  updatedAt?: number
}

interface PositionState {
  positions: Map<string, ReadingPosition>
  localChange?: { scope: string; position: ReadingPosition }
}

const key = READING_POSITION_STORAGE_KEY
const memory = createStore<PositionState>()(() => ({ positions: new Map() }))

function entries(): [string, ReadingPosition][] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "[]")

    if (!Array.isArray(stored)) return []

    return stored.slice(-READING_POSITION_LIMITS.entries).filter((entry): entry is [string, ReadingPosition] => {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || entry[0].length > READING_POSITION_LIMITS.scopeLength) return false
      const value = entry[1] as Partial<ReadingPosition> | null

      return (
        !!value &&
        typeof value.messageId === "string" &&
        value.messageId.length <= READING_POSITION_LIMITS.messageIdLength &&
        (value.cursor === undefined || (typeof value.cursor === "string" && value.cursor.length <= READING_POSITION_LIMITS.cursorLength)) &&
        (value.updatedAt === undefined || (Number.isSafeInteger(value.updatedAt) && value.updatedAt >= 0)) &&
        typeof value.offset === "number" &&
        Number.isFinite(value.offset) &&
        Math.abs(value.offset) < READING_POSITION_LIMITS.offset
      )
    })
  } catch {
    return []
  }
}

export function readPosition(scope: string | undefined): ReadingPosition | undefined {
  if (!scope) return undefined

  return memory.getState().positions.get(scope) ?? new Map(entries()).get(scope)
}

export function writePosition(scope: string, position: ReadingPosition) {
  const previous = readPosition(scope)

  if (
    previous?.updatedAt &&
    previous.messageId === position.messageId &&
    previous.offset === position.offset &&
    previous.cursor === position.cursor
  )
    return
  const next = { ...position, updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1) }

  storePosition(scope, next, true)
}

export function mergePosition(scope: string, position: ReadingPosition | null) {
  if (position && (position.updatedAt ?? 0) > (readPosition(scope)?.updatedAt ?? -1)) storePosition(scope, position)
}

export function subscribePositions(listener: (scope: string, position: ReadingPosition) => void) {
  return memory.subscribe((state, previous) => {
    if (state.localChange && state.localChange !== previous.localChange) listener(state.localChange.scope, state.localChange.position)
  })
}

function storePosition(scope: string, position: ReadingPosition, local = false) {
  const positions = new Map(memory.getState().positions)

  positions.delete(scope)
  positions.set(scope, position)
  if (positions.size > READING_POSITION_LIMITS.entries) positions.delete(positions.keys().next().value!)
  memory.setState({ positions, ...(local ? { localChange: { scope, position } } : {}) })

  try {
    const saved = new Map(entries())

    saved.delete(scope)
    saved.set(scope, position)
    localStorage.setItem(key, JSON.stringify([...saved].slice(-READING_POSITION_LIMITS.entries)))
  } catch {
    // Keep the in-memory bookmark when storage is unavailable or full.
  }
}
