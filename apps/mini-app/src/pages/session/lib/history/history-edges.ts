import { HistoryDirection, type HistoryNavigationDirection, type HistoryPageDirection } from "@protocol"
import { HistoryPageOutcome } from "@/entities/session"

/** Per direction, the edge message a completed page request left unchanged, which proves that edge exhausted. */
export type ExhaustedEdges = Record<HistoryPageDirection, string | null>

/** Records `edge` as exhausted only when the request completed; failed or stale requests keep the edge open. */
export function settleHistoryEdge(
  exhausted: ExhaustedEdges,
  direction: HistoryNavigationDirection,
  edge: string | undefined,
  outcome: HistoryPageOutcome | void,
): ExhaustedEdges {
  if (outcome !== HistoryPageOutcome.Loaded && outcome !== HistoryPageOutcome.Declined) return exhausted
  if (edge === undefined || direction === HistoryDirection.Latest || exhausted[direction] === edge) return exhausted

  return { ...exhausted, [direction]: edge }
}
