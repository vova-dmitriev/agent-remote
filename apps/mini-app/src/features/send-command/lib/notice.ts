import { ErrorCode } from "@protocol"
import { feedbackText, type Translate } from "@/shared/lib/i18n"

export function isUncertainCommand(error: string) {
  return [ErrorCode.COMMAND_STATUS_UNKNOWN, ErrorCode.COMMAND_PENDING_STATUS, ErrorCode.QUESTION_STATUS_UNKNOWN].some(
    (candidate) => candidate === error,
  )
}

export function commandErrorText(error: string, t: Translate) {
  return feedbackText(error, t)
}
