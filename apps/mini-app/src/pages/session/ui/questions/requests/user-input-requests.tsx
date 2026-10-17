import { CapabilityKey, DeviceStatus, CommandActionType } from "@protocol"
import { canSend, sessionUserInputs } from "@/entities/session"
import { SESSION_PAGE_IDS } from "@/pages/session/config/test-ids"
import { AnswerQuestion } from "../answer-question"
import type { UserInputRequestsProps } from "./user-input-requests.types"

export function UserInputRequests({ session, state, controller }: UserInputRequestsProps) {
  const requests = sessionUserInputs(state, session)
  const pending = new Set(controller.pendingUserInputs)

  const disabled =
    controller.busy || !canSend(state.connection, state.snapshot?.deviceStatus ?? DeviceStatus.Offline, session, CapabilityKey.UserInput)

  if (!requests.length) return null

  return (
    <div className="session-questions" data-testid={SESSION_PAGE_IDS.questions}>
      {requests.map((request) => (
        <AnswerQuestion
          key={JSON.stringify(request)}
          request={request}
          disabled={disabled || pending.has(request.requestId)}
          answer={(answers) => controller.action({ type: CommandActionType.UserInput, requestId: request.requestId, answers })}
        />
      ))}
    </div>
  )
}
