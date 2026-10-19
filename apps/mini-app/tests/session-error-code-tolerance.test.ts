import { expect, it } from "vitest"
import { deviceFrameSchema, ErrorCode, FrameType, Language, serverFrameSchema } from "@protocol"
import { createLanguageInstance, feedbackText, type Translate } from "../src/shared/lib/i18n/index.js"
import { sessionSnapshot } from "../../../tests/e2e/support/session-fixtures.js"

const FUTURE_CODE = "CODEX_SOMETHING_ADDED_LATER"

function snapshotWith(errorCode: string) {
  const snapshot = sessionSnapshot("device")

  return { ...snapshot, sessions: snapshot.sessions.map((session, index) => (index === 0 ? { ...session, errorCode } : session)) }
}

it("reads a session error code it does not know as the generic session reason instead of dropping the frame", () => {
  const snapshot = snapshotWith(FUTURE_CODE)
  const relayed = serverFrameSchema.parse({ type: FrameType.Snapshot, deviceId: "device", snapshot, connectors: [] })
  const received = deviceFrameSchema.parse({ type: FrameType.Snapshot, snapshot, connectors: [] })

  if (relayed.type !== FrameType.Snapshot || received.type !== FrameType.Snapshot) throw new Error("Expected snapshot frames")

  expect(relayed.snapshot.sessions).toHaveLength(snapshot.sessions.length)
  expect(relayed.snapshot.sessions[0]!.errorCode).toBe(ErrorCode.SESSION_UNAVAILABLE)
  expect(received.snapshot.sessions[0]!.errorCode).toBe(ErrorCode.SESSION_UNAVAILABLE)
  expect(relayed.snapshot.sessions[1]!.errorCode).toBeUndefined()

  const i18n = createLanguageInstance(Language.En)
  const t: Translate = (key) => i18n.t(key)

  expect(feedbackText(relayed.snapshot.sessions[0]!.errorCode!, t)).toBe(t("sessionUnavailable"))
})

it("keeps a known precise session error code on read", () => {
  const frame = serverFrameSchema.parse({
    type: FrameType.Snapshot,
    deviceId: "device",
    snapshot: snapshotWith(ErrorCode.CODEX_FRAME_TOO_LARGE),
    connectors: [],
  })

  if (frame.type !== FrameType.Snapshot) throw new Error("Expected a snapshot frame")

  expect(frame.snapshot.sessions[0]!.errorCode).toBe(ErrorCode.CODEX_FRAME_TOO_LARGE)
})
