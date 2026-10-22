import { ArrowLeft } from "lucide-react"
import { sessionTitle } from "@/entities/session"
import { feedbackText } from "@/shared/lib/i18n"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { Skeleton } from "@/shared/ui/skeleton"
import { cn } from "@/shared/lib/utils"
import { RULES_PAGE_IDS, RulesTabRole } from "../config/test-ids"
import { useOwnRule } from "../model/use-own-rule"
import { useRulesPage } from "../model/use-rules-page"
import { OwnRuleForm } from "./own-rule-form"
import { RulesTab } from "./rules-tab"
import type { RulesPageProps } from "./rules-page.types"

/** Settings → Rules: which commands of the agents stop and ask the owner, per project and session. */
export function RulesPage({ deviceId, online, session, onBack }: RulesPageProps) {
  const { t } = useTranslation()
  const label = t("rulesSessionTab", { title: (session && sessionTitle(session, 16)) ?? session?.id ?? "" })
  const page = useRulesPage(deviceId, session?.id ?? null, online, label)
  const own = useOwnRule({ compile: page.compile, save: page.save })

  return (
    <section data-testid={RULES_PAGE_IDS.root} className="mx-auto grid w-full max-w-3xl gap-[16px] py-[16px]">
      <div className="flex items-center gap-3">
        <Button data-testid={RULES_PAGE_IDS.back} variant="ghost" size="icon" onClick={onBack} aria-label={t("accountsBack")}>
          <ArrowLeft />
        </Button>
        <h1 className="flex-1 text-[22px] tracking-[-0.5px]">{t("rulesTitle")}</h1>
      </div>
      {page.view.isError ? (
        <p className="text-[13px]" data-testid={RULES_PAGE_IDS.failed}>
          {feedbackText(page.view.error.message, t)}
        </p>
      ) : null}
      {page.view.isPending && online ? <Skeleton className="h-[200px] rounded-[12px]" /> : null}
      {page.view.data && !page.tab ? (
        <p className="text-[13px] text-muted-foreground" data-testid={RULES_PAGE_IDS.empty}>
          {t("rulesNoProjects")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-[6px]" role="tablist" aria-label={t("rulesTitle")}>
        {page.tabs.map((tab) => (
          <Button
            key={tab.id}
            variant="outline"
            role={RulesTabRole.Tab}
            aria-selected={tab.id === page.tab?.id}
            className={cn(
              "h-[30px] max-w-[260px] rounded-full px-[12px] text-[12px]",
              tab.id === page.tab?.id && "border-primary text-primary",
            )}
            data-testid={RULES_PAGE_IDS.tab}
            data-tab={tab.id}
            onClick={() => page.select(tab.id)}
          >
            <span className="truncate">{tab.label}</span>
          </Button>
        ))}
      </div>
      {page.error ? <p className="text-[12px] text-danger">{feedbackText(page.error, t)}</p> : null}
      {page.tab ? (
        <RulesTab tab={page.tab} busy={page.busy} onToggle={page.toggle} onRemove={page.remove} onForget={page.forget}>
          <OwnRuleForm key={page.tab.id} controller={own} />
        </RulesTab>
      ) : null}
    </section>
  )
}
