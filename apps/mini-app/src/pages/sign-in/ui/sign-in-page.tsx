import { Sparkles } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { SIGN_IN_IDS } from "../config/test-ids"
import { HostKind } from "@protocol"
import { useHost } from "@/shared/lib/host"

export function SignInPage() {
  const { t } = useTranslation()
  const host = useHost()

  return (
    <section
      className="px-[20px] pt-[65px] pb-[90px] text-center phone:px-0 phone:pt-[45px] phone:pb-[60px]"
      data-testid={SIGN_IN_IDS.root}
    >
      <Sparkles className="mx-auto mb-8 size-12 text-primary" aria-hidden="true" />
      <h1 className="text-[35px] leading-[1.45] phone:text-[28px]" data-testid={SIGN_IN_IDS.title}>
        {t("signInTitle")}
        <br />
        {t("signInSubtitle")}
      </h1>
      <p className="mx-auto mt-[22px] max-w-[410px] leading-[1.7] text-muted-foreground">
        {t(host.kind === HostKind.Telegram ? "signInHint" : "extensionConnectHint")}
      </p>
    </section>
  )
}
