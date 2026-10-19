import { ArrowLeft, Plus, RefreshCw } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { ACCOUNTS_PAGE_IDS } from "../config/test-ids"
import { useAccountsLayout } from "../model/layout/use-accounts-layout"
import { AccountsFeedback } from "./status/accounts-feedback"
import { AccountsContent } from "./status/accounts-content"
import type { AccountsViewProps } from "./accounts-view.types"

export function AccountsView({
  data,
  loading,
  online,
  error,
  pending,
  busy,
  onRecover,
  onBack,
  onRefresh,
  children,
  creation,
}: AccountsViewProps) {
  const { t, language } = useTranslation()
  const layout = useAccountsLayout()

  return (
    <section data-testid={ACCOUNTS_PAGE_IDS.root} className="mx-auto grid w-full max-w-3xl gap-[16px] py-[16px]">
      <div className="flex flex-wrap items-center gap-3">
        <Button data-testid={ACCOUNTS_PAGE_IDS.back} variant="ghost" size="icon" onClick={onBack} aria-label={t("accountsBack")}>
          <ArrowLeft />
        </Button>
        <h1 data-testid={ACCOUNTS_PAGE_IDS.title} className="flex-1 text-[22px] tracking-[-0.5px]">
          {t("accountsTitle")}
        </h1>
        <Button
          data-testid={ACCOUNTS_PAGE_IDS.refresh}
          variant="outline"
          size="icon"
          disabled={!online || loading}
          onClick={onRefresh}
          aria-label={t("accountsRefresh")}
        >
          <RefreshCw />
        </Button>
      </div>
      {creation ? (
        <Button
          data-testid={ACCOUNTS_PAGE_IDS.add}
          variant="outline"
          className="justify-self-start"
          aria-expanded={layout.adding}
          onClick={layout.toggleAdding}
        >
          <Plus size={16} aria-hidden="true" />
          {t(layout.adding ? "accountsCancel" : "accountsAdd")}
        </Button>
      ) : null}
      <p className="text-muted-foreground">{t("accountsHint")}</p>
      <p className="text-sm text-muted-foreground">{t("accountsRoutingHint")}</p>
      <AccountsFeedback data={data} online={online} error={error} pending={pending} busy={busy} onRecover={onRecover} />
      {data?.observedAt ? (
        <p data-testid={ACCOUNTS_PAGE_IDS.lastChecked} className="text-sm text-muted-foreground">
          {t("accountsLastChecked", { time: new Date(data.observedAt).toLocaleString(language) })}
        </p>
      ) : null}
      {!online || data?.available === false ? (
        <p data-testid={ACCOUNTS_PAGE_IDS.offline} role="status">
          {t("accountsOffline")}
        </p>
      ) : null}
      {layout.adding ? creation : null}
      <AccountsContent data={data} online={online} loading={loading}>
        {children}
      </AccountsContent>
    </section>
  )
}
