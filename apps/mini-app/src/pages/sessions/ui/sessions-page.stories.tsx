import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { ThemePreference, Language } from "@protocol"
import { SessionsPageStory } from "@storybook-components/sessions-page-story"
import { sessionStatuses } from "@storybook-fixtures/page-states"
import { PAIR_DEVICE_IDS } from "@/features/pair-device"
import { DEVICE_ACCESS_IDS } from "@/features/device-access"

const meta = {
  component: SessionsPageStory,
} satisfies Meta<typeof SessionsPageStory>

export default meta
export const Loaded: StoryObj<typeof meta> = {}
export const Loading: StoryObj<typeof meta> = { args: { loading: true } }
export const Empty: StoryObj<typeof meta> = { args: { sessions: [] } }
export const AllStatuses: StoryObj<typeof meta> = { args: { sessions: sessionStatuses } }
export const ConnectionsAndSettings: StoryObj<typeof meta> = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(DEVICE_ACCESS_IDS.toggle))
  },
}
export const Pairing = { args: { sessions: [], connected: false } } satisfies StoryObj<typeof meta>
export const PairingManual = {
  args: Pairing.args,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(PAIR_DEVICE_IDS.manual))
    await userEvent.type(canvas.getByTestId(PAIR_DEVICE_IDS.code), "synthetic-pairing-code")
  },
} satisfies StoryObj<typeof meta>
export const PairingBusy: StoryObj<typeof meta> = { args: { ...Pairing.args, pairingBusy: true }, play: PairingManual.play }
export const PairingOffline: StoryObj<typeof meta> = { args: { ...Pairing.args, online: false }, play: PairingManual.play }

export const Dark: StoryObj<typeof meta> = { globals: { theme: ThemePreference.Dark } }

export const English: StoryObj<typeof meta> = { globals: { language: Language.En } }
