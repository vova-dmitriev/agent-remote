import { useTranslation } from "@/shared/lib/hooks"
import { feedbackText } from "@/shared/lib/i18n"
import { Button } from "@/shared/ui/button"
import { ACCOUNTS_PAGE_IDS } from "@/pages/accounts/config/test-ids"
import type { AccountsFeedbackProps } from "./accounts-feedback.types"

export function AccountsFeedback({ data, online, error, pending, busy, onRecover }: AccountsFeedbackProps) {
  const { t } = useTranslation()

  return (
    <div data-testid={ACCOUNTS_PAGE_IDS.feedback} className="contents">
      {pending ? (
        <div role="status" className="grid gap-2">
          <p>{t("accountsPendingHint")}</p>
          <Button data-testid={ACCOUNTS_PAGE_IDS.recover} disabled={!online || data?.available === false || busy} onClick={onRecover}>
            {t("accountsReconcile")}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p data-testid={ACCOUNTS_PAGE_IDS.error} role="alert" className="text-destructive">
          {feedbackText(error, t)}
        </p>
      ) : null}
    </div>
  )
}
