import { expect, it } from "vitest"
import { ControlStatus } from "@/features/send-command/config/values"
import { CommandActionType, AgentProvider } from "@protocol"
import { terminalSession } from "../.storybook/fixtures/session"
import { controlState } from "../src/features/send-command/model/controls/context-state"
import type { PendingControl } from "../src/features/send-command/model/controls/types"

function entry(
  type: typeof CommandActionType.CreateSession | typeof CommandActionType.Interrupt,
  status: PendingControl["status"],
): PendingControl {
  return {
    key: type,
    status,
    runtimeEpoch: 1,
    command: {
      commandId: type,
      sessionId: terminalSession.id,
      target: terminalSession.target,
      generation: terminalSession.generation,
      action: type === CommandActionType.CreateSession ? { type, provider: AgentProvider.Claude, cwd: "/synthetic" } : { type },
    },
  }
}

it("keeps creation pending in the session list without inheriting another session's controls", () => {
  expect(controlState([entry(CommandActionType.CreateSession, ControlStatus.Accepted)], undefined, 1).awaitingReceipt).toBe(true)
  expect(controlState([entry(CommandActionType.Interrupt, ControlStatus.Accepted)], undefined, 1).awaitingReceipt).toBe(false)
  expect(controlState([entry(CommandActionType.Interrupt, ControlStatus.Accepted)], "other-session", 1).awaitingReceipt).toBe(false)
})

it("preserves uncertain control state only for its current session and runtime", () => {
  expect(controlState([entry(CommandActionType.Interrupt, ControlStatus.Unknown)], terminalSession.id, 1)).toMatchObject({
    awaitingReceipt: false,
    uncertain: true,
  })

  expect(controlState([entry(CommandActionType.Interrupt, ControlStatus.Unknown)], terminalSession.id, 2)).toMatchObject({
    awaitingReceipt: false,
    uncertain: false,
  })
})

it("locks only the exact pending question and excludes obsolete bindings", () => {
  const question: PendingControl = {
    ...entry(CommandActionType.Interrupt, ControlStatus.Unknown),
    command: {
      ...entry(CommandActionType.Interrupt, ControlStatus.Unknown).command,
      action: { type: CommandActionType.UserInput, requestId: "old-question", answers: {} },
    },
  }

  expect(controlState([question], terminalSession.id, 1).pendingUserInputs).toEqual(["old-question"])
  expect(controlState([question], terminalSession.id, 1, "replacement").pendingUserInputs).toEqual([])
})
