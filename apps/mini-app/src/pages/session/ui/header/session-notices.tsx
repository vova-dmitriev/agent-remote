import { feedbackText } from "@/shared/lib/i18n"
import { useTranslation } from "@/shared/lib/hooks"
import { noticeVariants } from "@/shared/ui/notice"
import { REMOVE_SESSION_IDS } from "@/features/remove-session"
import { SWITCH_MODEL_IDS } from "@/features/switch-model"
import { SESSION_PAGE_IDS } from "@/pages/session/config/test-ids"
import type { SessionNoticesProps } from "../session-page.types"

/** The session's alerts under its header: a model switch or removal the device refused, and the source's own error. */
export function SessionNotices({ session, remove, switchModel }: SessionNoticesProps) {
  const { t } = useTranslation()

  return (
    <>
      {switchModel?.error ? (
        <p className={noticeVariants()} role="alert" data-testid={SWITCH_MODEL_IDS.error}>
          {t("modelSwitchFailed", { reason: feedbackText(switchModel.error, t) })}
        </p>
      ) : null}
      {remove?.failed ? (
        <p className={noticeVariants()} role="alert" data-testid={REMOVE_SESSION_IDS.error}>
          {t("removeFailed")}
        </p>
      ) : null}
      {session.errorCode ? (
        <p className={noticeVariants()} role="alert" data-testid={SESSION_PAGE_IDS.sourceError}>
          {feedbackText(session.errorCode, t)}
        </p>
      ) : null}
    </>
  )
}
