import { SessionCreation } from "@/features/create-session"
import { useTranslation } from "@/shared/lib/hooks"
import { mutedTextClass } from "@/shared/ui/text"
import { DESKTOP_IDS } from "@/app/config/test-ids"
import { sessionCreationProps } from "@/app/model/session-creation-props"
import type { DesktopPaneProps } from "./desktop-layout.types"

/** Desktop main pane for the sidebar's "New session": the shared create-session form without its toggle. */
export function DesktopNewSession({ model }: DesktopPaneProps) {
  const { t } = useTranslation()

  return (
    <section className="grid gap-[8px] py-[10px]" data-testid={DESKTOP_IDS.newSession}>
      <h1 className="text-[26px] tracking-[-0.8px]">{t("newSession")}</h1>
      <p className={mutedTextClass}>{t("newSessionHint")}</p>
      <SessionCreation {...sessionCreationProps(model)} inline />
    </section>
  )
}
