import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { Language } from "@protocol"
import { PairDeviceStory } from "@storybook-components/pair-device-story"
import { PAIR_DEVICE_IDS } from "@/features/pair-device"

const meta = { component: PairDeviceStory } satisfies Meta<typeof PairDeviceStory>

export default meta
export const Empty: StoryObj<typeof meta> = {}
export const Submitted: StoryObj<typeof meta> = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(PAIR_DEVICE_IDS.manual))
    await userEvent.type(canvas.getByTestId(PAIR_DEVICE_IDS.code), "synthetic-pairing-code")
    await userEvent.click(canvas.getByTestId(PAIR_DEVICE_IDS.submit))
  },
}

export const English: StoryObj<typeof meta> = { globals: { language: Language.En } }
