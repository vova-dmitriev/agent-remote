import { accountsFixture } from "../../fixtures/accounts/profiles"
import { AccountsView } from "@/pages/accounts/ui/accounts-view"
import { ProfileList } from "@/pages/accounts/ui/profile/profile-list"
import { ProfileCreateForm } from "@/pages/accounts/ui/management/profile-create-form"

/** Story-only: the accounts page with synthetic profiles, as the settings menu target. */
export function DesktopAccountsPane({ onBack }: { onBack: () => void }) {
  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <AccountsView
        data={accountsFixture}
        loading={false}
        online
        error=""
        onBack={onBack}
        onRefresh={() => {}}
        creation={<ProfileCreateForm disabled={false} submit={async () => null} />}
      >
        <ProfileList data={accountsFixture} disabled={false} run={async () => null} perform={async () => null} />
      </AccountsView>
    </div>
  )
}
