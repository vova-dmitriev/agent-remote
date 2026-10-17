import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent, within } from "storybook/test"
import { ThemePreference, Language } from "@protocol"
import { THEME_SWITCHER_IDS } from "../test-ids"
import { ThemeSwitcher } from "./theme-switcher"

const meta = { component: ThemeSwitcher } satisfies Meta<typeof ThemeSwitcher>

export default meta
export const Light: StoryObj<typeof meta> = { globals: { theme: ThemePreference.Light } }
export const Dark: StoryObj<typeof meta> = { globals: { theme: ThemePreference.Dark } }
export const English: StoryObj<typeof meta> = { globals: { language: Language.En } }
export const Open: StoryObj<typeof meta> = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(THEME_SWITCHER_IDS.trigger))
  },
}
export const OpenDark: StoryObj<typeof meta> = { ...Open, globals: { theme: ThemePreference.Dark } }
export const Automatic: StoryObj<typeof meta> = {
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByTestId(THEME_SWITCHER_IDS.trigger))
    await userEvent.click(within(canvasElement.ownerDocument.body).getByTestId(THEME_SWITCHER_IDS.auto))
  },
}
