import { Sparkles } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { SIGN_IN_IDS } from "../config/test-ids"
import { HostKind } from "@protocol"
import { useHost } from "@/shared/lib/host"

export function SignInPage() {
  const { t } = useTranslation()
  const host = useHost()

  return (
    <section className="empty" data-testid={SIGN_IN_IDS.root}>
      <Sparkles className="mx-auto mb-8 size-12 text-primary" aria-hidden="true" />
      <h1 data-testid={SIGN_IN_IDS.title}>
        {t("signInTitle")}
        <br />
        {t("signInSubtitle")}
      </h1>
      <p>{t(host.kind === HostKind.Telegram ? "signInHint" : "extensionConnectHint")}</p>
    </section>
  )
}
