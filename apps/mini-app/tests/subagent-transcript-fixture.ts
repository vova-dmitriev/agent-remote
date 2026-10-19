import { vi } from "vitest"
import { EventType, MessageRole, type EventEnvelope } from "@protocol"
import type { SubagentRead, SubagentTranscript } from "../src/pages/session/model/subagent/subagent-transcript"

export const visibility = { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} } as unknown as Document

export const page = (...ids: string[]): EventEnvelope[] =>
  ids.map(
    (id, index) =>
      ({
        version: 1,
        deviceId: "synthetic-device",
        streamId: "synthetic-stream",
        seq: index + 1,
        eventId: "event-" + id,
        sessionId: "synthetic-session",
        occurredAt: id.charCodeAt(0) * 100 + index,
        type: EventType.Message,
        payload: {
          id,
          role: MessageRole.Assistant,
          text: "Synthetic " + id,
          occurredAt: id.charCodeAt(0) * 100 + index,
          historyCursor: "position:" + id,
        },
      }) as EventEnvelope,
  )

export function deferred() {
  let resolve!: (events: EventEnvelope[] | null) => void
  let reject!: (error: Error) => void
  const promise = new Promise<EventEnvelope[] | null>((res, rej) => ((resolve = res), (reject = rej)))

  return { promise, resolve, reject }
}

export const ids = (transcript: SubagentTranscript) => transcript.getSnapshot().messages.map((message) => message.id)

/** A read whose responses the test releases one by one. */
export function gatedRead() {
  const gates: ReturnType<typeof deferred>[] = []

  const read = vi.fn<SubagentRead>(() => {
    const gate = deferred()

    gates.push(gate)

    return gate.promise
  })

  return { gates, read }
}
