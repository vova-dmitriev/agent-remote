import { expect, it } from "vitest"
import { DeviceStatus, SessionStatus, FrameType, ConnectionStatus, CapabilityKey } from "@protocol"
import { canSend, initialState, reduceSessionState } from "../src/entities/session/model/session-state"
import { sessionUserInputs } from "../src/entities/session/lib/selectors"
import { sessionSnapshot } from "../../../tests/e2e/support/session-fixtures"
import { questionRequest } from "../src/pages/session/ui/questions/fixtures"

it("filters questions by current session, generation and capability", () => {
  const snapshot = sessionSnapshot("synthetic-device")
  const session = { ...snapshot.sessions[0]!, capabilities: { ...snapshot.sessions[0]!.capabilities, userInput: true } }
  const current = { ...questionRequest, sessionId: session.id, generation: session.generation }
  const state = { ...initialState(), snapshot: { ...snapshot, userInputs: [current, { ...current, generation: "old" }, questionRequest] } }

  expect(sessionUserInputs(state, session)).toEqual([current])
  expect(sessionUserInputs(state, { ...session, status: SessionStatus.Ended })).toEqual([])
  expect(sessionUserInputs(state, { ...session, capabilities: { ...session.capabilities, userInput: false } })).toEqual([])
  expect(sessionUserInputs({ ...state, snapshot }, session)).toEqual([])
})

it("clears questions on device disconnect", () => {
  const snapshot = { ...sessionSnapshot("synthetic-device"), userInputs: [questionRequest] }
  const state = { ...initialState(), deviceId: "synthetic-device", snapshot }
  const next = reduceSessionState(state, { type: FrameType.DeviceStatus, deviceId: "synthetic-device", status: DeviceStatus.Offline })

  expect(next.snapshot?.userInputs).toEqual([])
})

it("allows answering while waiting for input, but fences offline, ended and disabled sessions", () => {
  const source = sessionSnapshot("synthetic-device").sessions[0]!
  const session = { ...source, status: SessionStatus.WaitingInput, capabilities: { ...source.capabilities, userInput: true } }

  expect(canSend(ConnectionStatus.Online, DeviceStatus.Online, session, CapabilityKey.UserInput)).toBe(true)
  expect(canSend(ConnectionStatus.Offline, DeviceStatus.Online, session, CapabilityKey.UserInput)).toBe(false)
  expect(canSend(ConnectionStatus.Online, DeviceStatus.Offline, session, CapabilityKey.UserInput)).toBe(false)

  expect(canSend(ConnectionStatus.Online, DeviceStatus.Online, { ...session, status: SessionStatus.Ended }, CapabilityKey.UserInput)).toBe(
    false,
  )

  expect(
    canSend(
      ConnectionStatus.Online,
      DeviceStatus.Online,
      { ...session, capabilities: { ...session.capabilities, userInput: false } },
      CapabilityKey.UserInput,
    ),
  ).toBe(false)
})
