import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { AgentProvider, ErrorCode, Language, ThemePreference } from "@protocol"
import { accountsFixture } from "@storybook-fixtures/accounts/profiles"
import { AccountsView } from "./accounts-view"
import { ProfileList } from "./profile/profile-list"
import { ProfileCreateForm } from "./management/profile-create-form"
import { ACCOUNTS_PAGE_IDS } from "../config/test-ids"
import { PROFILE_MANAGE_IDS } from "../config/management/test-ids"

const meta = {
  component: AccountsView,
  title: "Pages/Accounts",
  globals: { language: Language.En },
  args: {
    data: accountsFixture,
    loading: false,
    online: true,
    error: "",
    onBack: () => {},
    onRefresh: () => {},
  },
  render: (args) => (
    <AccountsView
      {...args}
      creation={<ProfileCreateForm disabled={!args.online || args.loading || !!args.pending} submit={async () => null} />}
    >
      {args.data ? (
        <ProfileList
          data={args.data}
          disabled={!args.online || args.loading || !!args.pending}
          run={async () => null}
          perform={async () => null}
        />
      ) : null}
    </AccountsView>
  ),
} satisfies Meta<typeof AccountsView>

export default meta
export const AccountsAndKeys: StoryObj<typeof meta> = {}
export const Dark: StoryObj<typeof meta> = { globals: { theme: ThemePreference.Dark } }
export const AddAccount: StoryObj<typeof meta> = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(ACCOUNTS_PAGE_IDS.add))
  },
}
export const ClaudeUnavailable: StoryObj<typeof meta> = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(ACCOUNTS_PAGE_IDS.add))
    await userEvent.selectOptions(canvas.getByTestId(PROFILE_MANAGE_IDS.provider), AgentProvider.Claude)
  },
}
export const Empty: StoryObj<typeof meta> = { args: { data: { ...accountsFixture, profiles: [] } } }
export const Loading: StoryObj<typeof meta> = { args: { data: undefined, loading: true } }
export const UnconfirmedOperation: StoryObj<typeof meta> = { args: { pending: true, onRecover: () => {} } }
export const MacOffline: StoryObj<typeof meta> = { args: { online: false } }
export const UntrustedRecipient: StoryObj<typeof meta> = { args: { error: ErrorCode.ENROLLMENT_KEY_UNTRUSTED } }
export const ForeignAccess: StoryObj<typeof meta> = { args: { data: undefined, error: ErrorCode.ACCESS_DENIED } }
