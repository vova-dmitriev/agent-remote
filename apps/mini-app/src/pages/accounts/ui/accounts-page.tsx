import { ProfileList } from "./profile/profile-list"
import { useExecutionProfiles } from "@/entities/execution-profile"
import { ProfileCreateForm } from "./management/profile-create-form"
import { useProfileManagement } from "../model/management/use-profile-management"
import { useTranslation } from "@/shared/lib/hooks"
import { ACCOUNTS_PAGE_IDS } from "../config/test-ids"
import { AccountsView } from "./accounts-view"
import type { AccountsPageProps } from "./accounts-page.types"

export function AccountsPage({ deviceId, online, onBack }: AccountsPageProps) {
  const { t } = useTranslation()
  const query = useExecutionProfiles(deviceId, online)
  const controller = useProfileManagement(deviceId)
  const data = query.data
  const available = online && data?.available !== false
  const disabled = !available || query.isFetching || controller.busy || !!controller.pending || !data

  return (
    <AccountsView
      data={data}
      loading={query.isPending && online}
      online={online}
      error={controller.error || query.error?.message || ""}
      onBack={onBack}
      onRefresh={() => void query.refetch()}
      pending={!!controller.pending}
      busy={controller.busy}
      onRecover={() => void controller.recover()}
      creation={<ProfileCreateForm disabled={disabled} submit={controller.run} />}
    >
      {controller.login ? (
        <div className="space-y-2 rounded-xl border border-border p-4">
          <p>{t("accountsLoginHint")}</p>
          <a
            data-testid={ACCOUNTS_PAGE_IDS.login}
            className="text-primary underline"
            href={controller.login.authUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("accountsOpenLogin")}
          </a>
        </div>
      ) : null}
      {data ? <ProfileList data={data} disabled={disabled} run={controller.run} perform={controller.perform} /> : null}
    </AccountsView>
  )
}
