import type { Meta, StoryObj } from "@storybook/react-vite"
import { ProviderFilterValue } from "@/pages/sessions/config/values"
import { ThemePreference } from "@protocol"
import { ProviderFilter } from "./provider-filter"

const meta = { component: ProviderFilter, args: { value: ProviderFilterValue.All, onChange: () => {} } } satisfies Meta<
  typeof ProviderFilter
>

export default meta
export const All: StoryObj<typeof meta> = {}
export const Claude: StoryObj<typeof meta> = { args: { value: ProviderFilterValue.Claude } }
export const Codex: StoryObj<typeof meta> = { args: { value: ProviderFilterValue.Codex } }
export const Dark: StoryObj<typeof meta> = { ...Codex, globals: { theme: ThemePreference.Dark } }
