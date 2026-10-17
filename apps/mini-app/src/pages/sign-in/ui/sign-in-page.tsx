import { Sparkles } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { SIGN_IN_IDS } from "../config/test-ids"

export function SignInPage() {
  const { t } = useTranslation()

  return (
    <section className="empty" data-testid={SIGN_IN_IDS.root}>
      <Sparkles className="mx-auto mb-8 size-12 text-primary" aria-hidden="true" />
      <h1 data-testid={SIGN_IN_IDS.title}>
        {t("signInTitle")}
        <br />
        {t("signInSubtitle")}
      </h1>
      <p>{t("signInHint")}</p>
    </section>
  )
}
