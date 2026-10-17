import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent, within } from "storybook/test"
import { Language, ThemePreference } from "@protocol"
import { LanguageSwitcher } from "./language-switcher"
import { LANGUAGE_SWITCHER_IDS } from "./test-ids"

const meta = { component: LanguageSwitcher } satisfies Meta<typeof LanguageSwitcher>

export default meta
export const Russian: StoryObj<typeof meta> = { globals: { language: Language.Ru } }
export const English: StoryObj<typeof meta> = { globals: { language: Language.En } }
export const Open: StoryObj<typeof meta> = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(LANGUAGE_SWITCHER_IDS.trigger))
  },
}
export const OpenDark: StoryObj<typeof meta> = { ...Open, globals: { theme: ThemePreference.Dark } }
export const Switched: StoryObj<typeof meta> = {
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByTestId(LANGUAGE_SWITCHER_IDS.trigger))
    await userEvent.click(within(canvasElement.ownerDocument.body).getByTestId(LANGUAGE_SWITCHER_IDS.en))
  },
}
