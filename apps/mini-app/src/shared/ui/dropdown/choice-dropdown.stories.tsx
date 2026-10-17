import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { Monitor, Moon } from "lucide-react"
import { ThemePreference } from "@protocol"
import { ChoiceDropdown } from "./choice-dropdown"
import { DROPDOWN_IDS } from "./test-ids"

const meta = {
  component: ChoiceDropdown,
  args: {
    value: "first",
    label: "Synthetic appearance",
    triggerLabel: "Automatic",
    icon: Monitor,
    ids: DROPDOWN_IDS,
    onChange: () => {},
    options: [
      { value: "first", label: "Automatic", description: "Follow your device", icon: Monitor, testId: DROPDOWN_IDS.first },
      { value: "second", label: "Dark", icon: Moon, testId: DROPDOWN_IDS.second },
    ],
  },
} satisfies Meta<typeof ChoiceDropdown>

export default meta
export const Closed: StoryObj<typeof meta> = {}
export const Open: StoryObj<typeof meta> = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(DROPDOWN_IDS.trigger))
  },
}
export const DarkOpen: StoryObj<typeof meta> = { ...Open, globals: { theme: ThemePreference.Dark } }
