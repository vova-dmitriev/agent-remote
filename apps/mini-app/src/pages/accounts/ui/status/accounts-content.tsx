import { useTranslation } from "@/shared/lib/hooks"
import { ACCOUNTS_PAGE_IDS } from "@/pages/accounts/config/test-ids"
import type { AccountsContentProps } from "./accounts-content.types"

export function AccountsContent({ data, online, loading, children }: AccountsContentProps) {
  const { t } = useTranslation()

  return (
    <div data-testid={ACCOUNTS_PAGE_IDS.content} className="contents">
      {loading && !data ? (
        <p data-testid={ACCOUNTS_PAGE_IDS.loading} role="status">
          {t("accountsLoading")}
        </p>
      ) : null}
      {!loading && online && data?.profiles.length === 0 ? <p data-testid={ACCOUNTS_PAGE_IDS.empty}>{t("accountsEmpty")}</p> : null}
      <div className="grid gap-3">{children}</div>
    </div>
  )
}
