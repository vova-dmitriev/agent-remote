import type { EventEnvelope } from "@protocol"
import { HistoryPageSkip } from "@/shared/api"
import { HistoryPageOutcome } from "../config/session-values"

const skipOutcomes: Record<HistoryPageSkip, HistoryPageOutcome> = {
  [HistoryPageSkip.Exhausted]: HistoryPageOutcome.Declined,
  [HistoryPageSkip.Busy]: HistoryPageOutcome.Busy,
  [HistoryPageSkip.Stale]: HistoryPageOutcome.Stale,
}

/** The outcome of a transport history read: a page of events, a skip reason, or null for a stale latest load. */
export function historyPageOutcome(result: EventEnvelope[] | HistoryPageSkip | null): HistoryPageOutcome {
  if (result === null) return HistoryPageOutcome.Stale

  return Array.isArray(result) ? HistoryPageOutcome.Loaded : skipOutcomes[result]
}
